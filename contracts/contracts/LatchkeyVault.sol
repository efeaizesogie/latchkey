// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice The read-only part of a TapeOut processor (TAP-02 §6).
interface ITapeoutProcessor {
    function step(uint256 id, bytes calldata state, bytes calldata inputs)
        external
        view
        returns (bytes memory newState, bytes memory outputs);
    function circuitInfo(uint256 id) external view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
}

/// @notice Announces vault events over TapeSend (see LatchkeyHerald). Never trusted for anything else.
interface ILatchkeyHerald {
    function graceStarted(address owner, address heir, address ownerInbox, uint64 tripsAt) external;
    function tripped(address heir, address heirInbox) external;
}

/// @title LatchkeyVault
/// @notice One person's vault. The owner checks in to prove they are still here. If they stay quiet for longer than
///         `window`, anyone can start a grace period; if the owner still does not check in before the grace period
///         ends (or 2 of 3 guardians confirm earlier), the latch trips, and from then on only the heir (or the owner's
///         own backup wallet) can take the funds out.
///
///         The state machine is a TapeOut circuit, not this contract: every check-in and every poke is one beat of
///         circuit `circuitId` on `processor` (`step`), with inputs (expired, alive, graceOver, g0, g1, g2) and the
///         stored state (warn, q). The circuit computes
///             warn' = NOT q AND NOT alive AND (warn OR expired)
///             q'    = q OR (NOT alive AND warn AND (graceOver OR MAJ3(g0, g1, g2)))
///         where MAJ3 is a second taped-out circuit, included by REF. This contract only derives the input bits from
///         the clock and the guardians' confirmations, and stores the bits the circuit returns. Once q is 1 it can
///         never be cleared.
///
///         No admin, no upgrade, no pause. Fees and their recipient are fixed when the factory is deployed.
contract LatchkeyVault {
    using SafeERC20 for IERC20;

    // ---- set once by the factory (clones) ----
    address public factory;
    ITapeoutProcessor public processor;
    uint256 public circuitId;
    address public treasury;
    uint16 public claimFeeBps;
    ILatchkeyHerald public herald;

    // ---- the vault ----
    address public owner;
    address public heir;
    uint64 public window; // seconds of silence before a grace period can start
    uint64 public grace; // seconds of grace period before the latch can trip
    uint64 public lastCheckIn; // the owner's last sign of life
    uint64 public warnedAt; // when the grace period started (0 if none is running)
    uint64 public trippedAt; // 0 while open
    uint8 public state; // the circuit's state bits: bit 0 warn, bit 1 q (tripped)
    uint64 public beats; // times the circuit has been stepped for this vault
    uint64 public createdBlock;

    address[3] internal _guardians; // optional; address(0) = empty seat
    uint8 public confirmations; // bit i set when guardian i confirmed during the current grace period

    /// @notice Optional TapeSend inboxes (circuit containers on X Layer) that the herald writes to.
    address public ownerInbox;
    address public heirInbox;

    struct BeatRecord {
        uint64 blockNumber;
        uint64 time;
        uint8 stateBefore;
        uint8 inputs; // bit 0 expired, 1 alive, 2 graceOver, 3-5 guardians
        uint8 stateAfter;
    }

    BeatRecord[] internal _history;
    uint8 private _lock;

    uint64 public constant MIN_WINDOW = 1 minutes; // short windows exist for demos; the app offers 30+ days
    uint64 public constant MAX_WINDOW = 3650 days;
    uint64 public constant MIN_GRACE = 1 minutes;
    uint64 public constant MAX_GRACE = 365 days;
    /// @notice If the TapeOut processor ever stops answering, the latch can still trip this long after it could have.
    uint64 public constant CIRCUIT_FALLBACK_DELAY = 30 days;
    uint256 internal constant HERALD_GAS = 600_000;

    uint8 internal constant WARN = 1;
    uint8 internal constant TRIPPED = 2;

    event Initialized(address indexed owner, address indexed heir, uint64 window, uint64 grace);
    event CheckedIn(uint64 at, uint64 deadline);
    event Beat(uint64 indexed n, uint8 stateBefore, uint8 inputs, uint8 stateAfter, uint256 block_);
    event GraceStarted(address indexed by, uint64 at, uint64 tripsAt);
    event GraceCancelled(uint64 at);
    event Tripped(address indexed by, uint64 at);
    event Confirmed(address indexed guardian, uint8 confirmations);
    event HeirChanged(address indexed heir);
    event SettingsChanged(uint64 window, uint64 grace);
    event GuardiansChanged(address[3] guardians);
    event InboxesChanged(address ownerInbox, address heirInbox);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event Claimed(address indexed token, address indexed to, uint256 amount, uint256 fee);
    event Deposited(address indexed from, uint256 amount);
    event CircuitUnavailable(uint64 at);
    event HeraldFailed(uint8 what);

    error AlreadyInitialized();
    error NotOwner();
    error NotHeir();
    error NotGuardian();
    error IsTripped();
    error NotTripped();
    error NothingToDo(uint64 nextChangeAt);
    error NoGracePeriod();
    error BadWindow();
    error BadAddress();
    error CircuitFailed();
    error CircuitWorks();
    error Reentrant();
    error TransferFailed();
    error NeedMoreGas();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whileOpen() {
        if (state & TRIPPED != 0) revert IsTripped();
        _;
    }

    modifier nonReentrant() {
        if (_lock == 1) revert Reentrant();
        _lock = 1;
        _;
        _lock = 0;
    }

    struct Config {
        address owner;
        address heir;
        uint64 window;
        uint64 grace;
        address[3] guardians;
        address ownerInbox;
        address heirInbox;
    }

    function initialize(
        Config calldata c,
        ITapeoutProcessor processor_,
        uint256 circuitId_,
        address treasury_,
        uint16 claimFeeBps_,
        ILatchkeyHerald herald_
    ) external {
        if (factory != address(0)) revert AlreadyInitialized();
        if (c.owner == address(0) || c.heir == address(0) || c.heir == c.owner) revert BadAddress();
        _checkTimes(c.window, c.grace);
        factory = msg.sender;
        processor = processor_;
        circuitId = circuitId_;
        treasury = treasury_;
        claimFeeBps = claimFeeBps_;
        herald = herald_;
        owner = c.owner;
        heir = c.heir;
        window = c.window;
        grace = c.grace;
        _setGuardians(c.guardians);
        ownerInbox = c.ownerInbox;
        heirInbox = c.heirInbox;
        lastCheckIn = uint64(block.timestamp);
        createdBlock = uint64(block.number);
        emit Initialized(c.owner, c.heir, c.window, c.grace);
        emit CheckedIn(lastCheckIn, deadline());
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    // ------------------------------------------------------------------ views

    /// @notice When a grace period can start if the owner stays quiet.
    function deadline() public view returns (uint64) {
        return lastCheckIn + window;
    }

    /// @notice When the running grace period ends (0 if none is running).
    function graceEndsAt() public view returns (uint64) {
        return state & WARN != 0 ? warnedAt + grace : 0;
    }

    function guardians() external view returns (address[3] memory) {
        return _guardians;
    }

    /// @notice The input bits the vault would give the circuit now, for a poke (alive = 0).
    function inputsNow() public view returns (uint8) {
        return _inputs(0);
    }

    /// @notice What the circuit would answer for a poke right now: (newState, wouldChange). No state change.
    function preview() external view returns (uint8 next, bool changes) {
        (bool ok, uint8 n) = _tryStep(_inputs(0));
        if (!ok) return (state, false);
        return (n, n != state);
    }

    /// @notice Everything a UI needs in one call.
    function snapshot()
        external
        view
        returns (
            address owner_,
            address heir_,
            uint64 window_,
            uint64 grace_,
            uint64 lastCheckIn_,
            uint64 warnedAt_,
            uint64 trippedAt_,
            uint8 state_,
            uint8 confirmations_,
            uint64 beats_,
            uint256 okb
        )
    {
        return (owner, heir, window, grace, lastCheckIn, warnedAt, trippedAt, state, confirmations, beats, address(this).balance);
    }

    /// @notice Beat records [from, from + n), clipped to the end. Public RPCs cap log queries, so history lives here.
    function history(uint256 from, uint256 n) external view returns (BeatRecord[] memory out) {
        uint256 len = _history.length;
        if (from >= len) return out;
        uint256 end = from + n > len ? len : from + n;
        out = new BeatRecord[](end - from);
        for (uint256 i = from; i < end; ++i) out[i - from] = _history[i];
    }

    // ------------------------------------------------------------------ owner

    /// @notice "I'm still here." One beat with alive = 1: cancels any grace period and restarts the window.
    function checkIn() external onlyOwner whileOpen {
        _alive();
    }

    function setHeir(address heir_, address heirInbox_) external onlyOwner whileOpen {
        if (heir_ == address(0) || heir_ == owner) revert BadAddress();
        heir = heir_;
        heirInbox = heirInbox_;
        emit HeirChanged(heir_);
        emit InboxesChanged(ownerInbox, heirInbox_);
        _alive();
    }

    function setTimes(uint64 window_, uint64 grace_) external onlyOwner whileOpen {
        _checkTimes(window_, grace_);
        window = window_;
        grace = grace_;
        emit SettingsChanged(window_, grace_);
        _alive();
    }

    function setGuardians(address[3] calldata g) external onlyOwner whileOpen {
        _setGuardians(g);
        _alive();
    }

    function setOwnerInbox(address inbox) external onlyOwner whileOpen {
        ownerInbox = inbox;
        emit InboxesChanged(inbox, heirInbox);
        _alive();
    }

    /// @notice The owner can always take funds back while the latch is open. token = address(0) for OKB.
    function withdraw(address token, uint256 amount, address to) external onlyOwner whileOpen nonReentrant {
        if (to == address(0)) revert BadAddress();
        // Never let a broken processor lock the owner out of their own money.
        (bool ok,) = _tryStep(_inputs(1));
        if (ok) _alive();
        else _checkInWithoutCircuit();
        _send(token, to, amount);
        emit Withdrawn(token, to, amount);
    }

    // ------------------------------------------------------------------ guardians

    /// @notice A guardian confirms, during a grace period, that the owner is really gone. 2 of 3 end it early.
    function confirm() external whileOpen {
        if (state & WARN == 0) revert NoGracePeriod();
        for (uint8 i; i < 3; ++i) {
            if (_guardians[i] != address(0) && _guardians[i] == msg.sender) {
                confirmations |= uint8(1 << i);
                emit Confirmed(msg.sender, confirmations);
                return;
            }
        }
        revert NotGuardian();
    }

    // ------------------------------------------------------------------ anyone

    /// @notice Advance the latch. Anyone can call it; the circuit decides. The first poke after the window starts
    ///         the grace period, a later one trips the latch. Reverts if the circuit leaves the state unchanged.
    function poke() external whileOpen {
        uint8 before = state;
        uint8 next = _beat(_inputs(0));
        if (next == before) revert NothingToDo(before & WARN != 0 ? graceEndsAt() : deadline());
        if (next & TRIPPED != 0) {
            trippedAt = uint64(block.timestamp);
            emit Tripped(msg.sender, trippedAt);
            _herald(2);
        } else if (next & WARN != 0 && before & WARN == 0) {
            warnedAt = uint64(block.timestamp);
            emit GraceStarted(msg.sender, warnedAt, warnedAt + grace);
            _herald(1);
        }
    }

    /// @notice Safety valve: only if the processor call fails (not if it answers), and only 30 days after the latch
    ///         could have tripped (window + grace), the latch trips without the circuit, so an heir is never locked out.
    function tripWithoutCircuit() external whileOpen {
        (bool ok,) = _tryStep(_inputs(0));
        if (ok) revert CircuitWorks();
        uint256 at = uint256(deadline()) + grace + CIRCUIT_FALLBACK_DELAY;
        if (block.timestamp < at) revert NothingToDo(uint64(at));
        state = WARN | TRIPPED;
        trippedAt = uint64(block.timestamp);
        emit CircuitUnavailable(trippedAt);
        emit Tripped(msg.sender, trippedAt);
    }

    // ------------------------------------------------------------------ heir

    /// @notice After the latch trips, the heir takes everything listed. token = address(0) for OKB.
    ///         Can be called again for anything deposited later.
    function claim(address[] calldata tokens) external nonReentrant {
        if (msg.sender != heir) revert NotHeir();
        if (state & TRIPPED == 0) revert NotTripped();
        for (uint256 i; i < tokens.length; ++i) {
            address t = tokens[i];
            uint256 bal = t == address(0) ? address(this).balance : IERC20(t).balanceOf(address(this));
            if (bal == 0) continue;
            uint256 fee = (bal * claimFeeBps) / 10_000;
            if (fee > 0 && treasury != address(0)) _send(t, treasury, fee);
            else fee = 0;
            _send(t, heir, bal - fee);
            emit Claimed(t, heir, bal - fee, fee);
        }
    }

    // ------------------------------------------------------------------ internals

    function _checkTimes(uint64 window_, uint64 grace_) internal pure {
        if (window_ < MIN_WINDOW || window_ > MAX_WINDOW || grace_ < MIN_GRACE || grace_ > MAX_GRACE) revert BadWindow();
    }

    function _setGuardians(address[3] memory g) internal {
        for (uint256 i; i < 3; ++i) {
            if (g[i] != address(0)) {
                if (g[i] == owner || g[i] == heir) revert BadAddress();
                for (uint256 j; j < i; ++j) if (g[i] == g[j]) revert BadAddress();
            }
            _guardians[i] = g[i];
        }
        confirmations = 0;
        emit GuardiansChanged(_guardians);
    }

    /// @dev Input bits: 0 expired, 1 alive, 2 graceOver, 3..5 guardian confirmations.
    function _inputs(uint8 alive) internal view returns (uint8 b) {
        if (block.timestamp >= deadline()) b |= 1;
        if (alive != 0) b |= 2;
        if (state & WARN != 0 && block.timestamp >= uint256(warnedAt) + grace) b |= 4;
        b |= (confirmations & 7) << 3;
    }

    function _alive() internal {
        bool wasWarned = state & WARN != 0;
        _beat(_inputs(1));
        lastCheckIn = uint64(block.timestamp);
        if (wasWarned) {
            warnedAt = 0;
            emit GraceCancelled(lastCheckIn);
        }
        confirmations = 0;
        emit CheckedIn(lastCheckIn, deadline());
    }

    function _checkInWithoutCircuit() internal {
        lastCheckIn = uint64(block.timestamp);
        state = 0;
        warnedAt = 0;
        confirmations = 0;
        emit CircuitUnavailable(lastCheckIn);
        emit CheckedIn(lastCheckIn, deadline());
    }

    /// @dev One stored beat: the circuit's new state becomes the vault's state.
    function _beat(uint8 inputs) internal returns (uint8 next) {
        uint8 before = state;
        bool ok;
        (ok, next) = _tryStep(inputs);
        if (!ok) revert CircuitFailed();
        state = next;
        unchecked {
            ++beats;
        }
        _history.push(BeatRecord(uint64(block.number), uint64(block.timestamp), before, inputs, next));
        emit Beat(beats, before, inputs, next, block.number);
    }

    /// @dev processor.step(circuitId, [warn, q], [6 input bits]) with a gas cap; checks the shape and that the outputs
    ///      equal the new state (both are (warn', q') in this circuit, so a mismatch means a different circuit).
    function _tryStep(uint8 inputs) internal view returns (bool, uint8) {
        bytes memory st = new bytes(1);
        st[0] = bytes1(state);
        bytes memory ins = new bytes(1);
        ins[0] = bytes1(inputs);
        (bool ok, bytes memory ret) =
            address(processor).staticcall{gas: 2_000_000}(abi.encodeCall(ITapeoutProcessor.step, (circuitId, st, ins)));
        if (!ok || ret.length < 192) return (false, 0);
        (bytes memory newState, bytes memory outputs) = abi.decode(ret, (bytes, bytes));
        if (newState.length != 1 || outputs.length != 1) return (false, 0);
        uint8 n = uint8(newState[0]) & 3;
        if ((uint8(outputs[0]) & 3) != n) return (false, 0);
        // q can never fall back to 0, whatever a processor answers
        if (state & TRIPPED != 0 && n & TRIPPED == 0) return (false, 0);
        return (true, n);
    }

    /// @dev Best effort: a failing herald (or TapeSend) never blocks the vault. But the transaction must carry enough
    ///      gas for the herald to try: otherwise a wallet's gas estimate settles on the cheapest limit at which the
    ///      outer call succeeds, which is the one where the herald silently runs out of gas.
    function _herald(uint8 what) internal {
        if (address(herald) == address(0)) return;
        if (gasleft() < (HERALD_GAS * 64) / 63 + 20_000) revert NeedMoreGas();
        if (what == 1) {
            try herald.graceStarted{gas: HERALD_GAS}(owner, heir, ownerInbox, warnedAt + grace) {}
            catch {
                emit HeraldFailed(what);
            }
        } else {
            try herald.tripped{gas: HERALD_GAS}(heir, heirInbox) {}
            catch {
                emit HeraldFailed(what);
            }
        }
    }

    function _send(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
