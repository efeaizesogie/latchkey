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

/// @title LatchkeyVault
/// @notice One person's vault. The owner checks in to prove they are still here. If they stay quiet for
///         longer than `window`, anyone may trip the latch, and from then on only the heir (or the owner's own
///         backup wallet) can take the funds out.
///
///         The latch bit is decided by a TapeOut circuit, not by this contract: every check-in and every trip is
///         one beat of circuit `circuitId` on `processor` (`step`), with inputs (expired, alive) and the stored
///         latch as state. The circuit computes q' = q OR (expired AND NOT alive), so once tripped it can never
///         be cleared. This contract only computes `expired` from the clock and stores the bit the circuit returns.
///
///         There is no admin, no upgrade and no pause. Fees and their recipient are fixed when the factory is
///         deployed and are capped there.
contract LatchkeyVault {
    using SafeERC20 for IERC20;

    // ---- immutable-after-init configuration (clones: set once in initialize) ----
    address public factory;
    ITapeoutProcessor public processor;
    uint256 public circuitId;
    address public treasury;
    uint16 public claimFeeBps;

    // ---- the vault ----
    address public owner;
    address public heir;
    uint64 public window; // seconds of silence before the latch may trip
    uint64 public lastCheckIn; // timestamp of the owner's last sign of life
    uint64 public trippedAt; // 0 while open
    uint8 public latch; // the circuit's state bit: 0 open, 1 tripped
    uint64 public beats; // how many times the circuit has been stepped for this vault

    uint8 private _lock;

    uint64 public constant MIN_WINDOW = 1 minutes; // short windows exist for demos; the app offers 30+ days
    uint64 public constant MAX_WINDOW = 3650 days;

    event Initialized(address indexed owner, address indexed heir, uint64 window);
    event CheckedIn(uint64 at, uint64 deadline);
    event Beat(uint64 indexed n, uint8 stateBefore, uint8 expired, uint8 alive, uint8 stateAfter, uint256 block_);
    event Tripped(address indexed by, uint64 at);
    event HeirChanged(address indexed heir);
    event WindowChanged(uint64 window);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event Claimed(address indexed token, address indexed to, uint256 amount, uint256 fee);
    event Deposited(address indexed from, uint256 amount);

    error AlreadyInitialized();
    error NotOwner();
    error NotHeir();
    error IsTripped();
    error NotTripped();
    error NotYet(uint64 deadline);
    error BadWindow();
    error BadAddress();
    error CircuitFailed();
    error Reentrant();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whileOpen() {
        if (latch != 0) revert IsTripped();
        _;
    }

    modifier nonReentrant() {
        if (_lock == 1) revert Reentrant();
        _lock = 1;
        _;
        _lock = 0;
    }

    function initialize(
        address owner_,
        address heir_,
        uint64 window_,
        ITapeoutProcessor processor_,
        uint256 circuitId_,
        address treasury_,
        uint16 claimFeeBps_
    ) external {
        if (factory != address(0)) revert AlreadyInitialized();
        if (owner_ == address(0) || heir_ == address(0) || heir_ == owner_) revert BadAddress();
        if (window_ < MIN_WINDOW || window_ > MAX_WINDOW) revert BadWindow();
        factory = msg.sender;
        processor = processor_;
        circuitId = circuitId_;
        treasury = treasury_;
        claimFeeBps = claimFeeBps_;
        owner = owner_;
        heir = heir_;
        window = window_;
        lastCheckIn = uint64(block.timestamp);
        emit Initialized(owner_, heir_, window_);
        emit CheckedIn(lastCheckIn, deadline());
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    // ------------------------------------------------------------------ views

    /// @notice When the latch becomes trippable if the owner stays quiet.
    function deadline() public view returns (uint64) {
        return lastCheckIn + window;
    }

    function expired() public view returns (bool) {
        return block.timestamp >= deadline();
    }

    /// @notice What the circuit would answer right now for a trip (no state change). Useful for UIs and keepers.
    function canTrip() external view returns (bool) {
        if (latch != 0) return false;
        return _step(expired() ? 1 : 0, 0) == 1;
    }

    // ------------------------------------------------------------------ owner

    /// @notice "I'm still here." Runs one beat with alive = 1 and restarts the window.
    function checkIn() external onlyOwner whileOpen {
        _alive();
    }

    function setHeir(address heir_) external onlyOwner whileOpen {
        if (heir_ == address(0) || heir_ == owner) revert BadAddress();
        heir = heir_;
        emit HeirChanged(heir_);
        _alive();
    }

    function setWindow(uint64 window_) external onlyOwner whileOpen {
        if (window_ < MIN_WINDOW || window_ > MAX_WINDOW) revert BadWindow();
        window = window_;
        emit WindowChanged(window_);
        _alive();
    }

    /// @notice The owner can always take funds back while the latch is open. token = address(0) for OKB.
    function withdraw(address token, uint256 amount, address to) external onlyOwner whileOpen nonReentrant {
        if (to == address(0)) revert BadAddress();
        _alive();
        _send(token, to, amount);
        emit Withdrawn(token, to, amount);
    }

    // ------------------------------------------------------------------ anyone

    /// @notice Trip the latch. Anyone can call it; the circuit decides. Reverts if the circuit keeps it open.
    function trip() external whileOpen {
        uint8 e = expired() ? 1 : 0;
        uint8 next = _beat(e, 0);
        if (next != 1) revert NotYet(deadline());
        trippedAt = uint64(block.timestamp);
        emit Tripped(msg.sender, trippedAt);
    }

    // ------------------------------------------------------------------ heir

    /// @notice After the latch trips, the heir takes everything listed. token = address(0) for OKB.
    ///         Can be called again for anything deposited later.
    function claim(address[] calldata tokens) external nonReentrant {
        if (msg.sender != heir) revert NotHeir();
        if (latch != 1) revert NotTripped();
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

    function _alive() internal {
        _beat(expired() ? 1 : 0, 1);
        lastCheckIn = uint64(block.timestamp);
        emit CheckedIn(lastCheckIn, deadline());
    }

    /// @dev One stored beat: the circuit's new state becomes the latch.
    function _beat(uint8 e, uint8 alive) internal returns (uint8 next) {
        uint8 before = latch;
        next = _step(e, alive);
        latch = next;
        unchecked {
            ++beats;
        }
        emit Beat(beats, before, e, alive, next, block.number);
    }

    /// @dev Calls processor.step(circuitId, [latch], [expired | alive << 1]) with a gas cap and checks the shape.
    function _step(uint8 e, uint8 alive) internal view returns (uint8) {
        bytes memory state = new bytes(1);
        state[0] = bytes1(latch);
        bytes memory inputs = new bytes(1);
        inputs[0] = bytes1(e | (alive << 1));
        (bool ok, bytes memory ret) = address(processor).staticcall{gas: 1_000_000}(
            abi.encodeCall(ITapeoutProcessor.step, (circuitId, state, inputs))
        );
        if (!ok || ret.length < 128) revert CircuitFailed();
        (bytes memory newState, bytes memory outputs) = abi.decode(ret, (bytes, bytes));
        if (newState.length != 1 || outputs.length != 1) revert CircuitFailed();
        uint8 q = uint8(newState[0]) & 1;
        // The output pin is the same signal as the latch's d input; a mismatch means a different circuit.
        if ((uint8(outputs[0]) & 1) != q) revert CircuitFailed();
        return q;
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
