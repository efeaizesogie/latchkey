// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {LatchkeyVault, ITapeoutProcessor, ILatchkeyHerald} from "./LatchkeyVault.sol";

/// @title LatchkeyFactory
/// @notice Creates Latchkey vaults (minimal clones of one implementation) wired to one TapeOut latch circuit.
///         Everything is fixed at deployment: processor, circuit, herald, treasury, setup fee and claim fee.
///         No owner, no setters, no upgrades: if the people who deployed it disappear, it keeps working.
contract LatchkeyFactory {
    address public immutable implementation;
    ITapeoutProcessor public immutable processor;
    uint256 public immutable circuitId;
    ILatchkeyHerald public immutable herald;
    address public immutable treasury;
    uint256 public immutable setupFee; // in OKB (wei), paid once per vault
    uint16 public immutable claimFeeBps; // taken from the heir's claim

    uint16 public constant MAX_CLAIM_FEE_BPS = 100; // 1%

    address[] public allVaults;
    mapping(address => address[]) internal _byOwner;
    mapping(address => address[]) internal _byHeir;
    mapping(address => address[]) internal _byGuardian;
    mapping(address => bool) public isVault;

    event VaultCreated(address indexed vault, address indexed owner, address indexed heir, uint64 window, uint64 grace, uint256 deposit);

    error FeeTooHigh();
    error SetupFee(uint256 required);
    error TransferFailed();
    error BadCircuit();

    constructor(
        ITapeoutProcessor processor_,
        uint256 circuitId_,
        ILatchkeyHerald herald_,
        address treasury_,
        uint256 setupFee_,
        uint16 claimFeeBps_
    ) {
        if (claimFeeBps_ > MAX_CLAIM_FEE_BPS) revert FeeTooHigh();
        (uint32 nIn, uint32 nOut, uint32 nState,) = processor_.circuitInfo(circuitId_);
        if (nIn != 6 || nOut != 2 || nState != 2) revert BadCircuit();
        implementation = address(new LatchkeyVault());
        processor = processor_;
        circuitId = circuitId_;
        herald = herald_;
        treasury = treasury_;
        setupFee = setupFee_;
        claimFeeBps = claimFeeBps_;
    }

    /// @notice Create a vault for msg.sender. msg.value covers the setup fee; anything above it is deposited as OKB.
    /// @param guardians up to three people who can end a grace period early (2 of 3); address(0) for empty seats
    /// @param ownerInbox, heirInbox optional TapeSend inboxes (circuit containers) for the herald's messages
    function createVault(
        address heir,
        uint64 window,
        uint64 grace,
        address[3] calldata guardians,
        address ownerInbox,
        address heirInbox
    ) external payable returns (address vault) {
        if (msg.value < setupFee) revert SetupFee(setupFee);
        vault = Clones.clone(implementation);
        LatchkeyVault(payable(vault)).initialize(
            LatchkeyVault.Config(msg.sender, heir, window, grace, guardians, ownerInbox, heirInbox),
            processor,
            circuitId,
            treasury,
            claimFeeBps,
            herald
        );
        allVaults.push(vault);
        _byOwner[msg.sender].push(vault);
        _byHeir[heir].push(vault);
        for (uint256 i; i < 3; ++i) if (guardians[i] != address(0)) _byGuardian[guardians[i]].push(vault);
        isVault[vault] = true;

        uint256 deposit = msg.value - setupFee;
        if (setupFee > 0) _pay(treasury, setupFee);
        if (deposit > 0) _pay(vault, deposit);
        emit VaultCreated(vault, msg.sender, heir, window, grace, deposit);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    /// @notice Vaults [from, from + n), clipped, for explorers and the stats page.
    function vaultsPage(uint256 from, uint256 n) external view returns (address[] memory out) {
        uint256 len = allVaults.length;
        if (from >= len) return out;
        uint256 end = from + n > len ? len : from + n;
        out = new address[](end - from);
        for (uint256 i = from; i < end; ++i) out[i - from] = allVaults[i];
    }

    function vaultsOf(address owner) external view returns (address[] memory) {
        return _byOwner[owner];
    }

    /// @notice Vaults that named this address at creation (later changes are read from each vault).
    function vaultsForHeir(address heir) external view returns (address[] memory) {
        return _byHeir[heir];
    }

    function vaultsForGuardian(address guardian) external view returns (address[] memory) {
        return _byGuardian[guardian];
    }

    function _pay(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
