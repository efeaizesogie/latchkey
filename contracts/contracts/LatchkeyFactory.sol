// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {LatchkeyVault, ITapeoutProcessor} from "./LatchkeyVault.sol";

/// @title LatchkeyFactory
/// @notice Creates Latchkey vaults (minimal clones of one implementation) wired to one TapeOut latch circuit.
///         Everything is fixed at deployment: processor, circuit, treasury, setup fee and claim fee.
///         No owner, no setters, no upgrades: if the people who deployed it disappear, it keeps working.
contract LatchkeyFactory {
    address public immutable implementation;
    ITapeoutProcessor public immutable processor;
    uint256 public immutable circuitId;
    address public immutable treasury;
    uint256 public immutable setupFee; // in OKB (wei), paid once per vault
    uint16 public immutable claimFeeBps; // taken from the heir's claim

    uint16 public constant MAX_CLAIM_FEE_BPS = 100; // 1%

    address[] public allVaults;
    mapping(address => address[]) internal _byOwner;
    mapping(address => address[]) internal _byHeir;
    mapping(address => bool) public isVault;

    event VaultCreated(address indexed vault, address indexed owner, address indexed heir, uint64 window, uint256 deposit);

    error FeeTooHigh();
    error SetupFee(uint256 required);
    error TransferFailed();
    error BadCircuit();

    constructor(ITapeoutProcessor processor_, uint256 circuitId_, address treasury_, uint256 setupFee_, uint16 claimFeeBps_) {
        if (claimFeeBps_ > MAX_CLAIM_FEE_BPS) revert FeeTooHigh();
        (uint32 nIn, uint32 nOut, uint32 nState,) = processor_.circuitInfo(circuitId_);
        if (nIn != 2 || nOut != 1 || nState != 1) revert BadCircuit();
        implementation = address(new LatchkeyVault());
        processor = processor_;
        circuitId = circuitId_;
        treasury = treasury_;
        setupFee = setupFee_;
        claimFeeBps = claimFeeBps_;
    }

    /// @notice Create a vault. msg.value covers the setup fee; anything above it is deposited into the vault as OKB.
    function createVault(address heir, uint64 window) external payable returns (address vault) {
        if (msg.value < setupFee) revert SetupFee(setupFee);
        vault = Clones.clone(implementation);
        LatchkeyVault(payable(vault)).initialize(msg.sender, heir, window, processor, circuitId, treasury, claimFeeBps);
        allVaults.push(vault);
        _byOwner[msg.sender].push(vault);
        _byHeir[heir].push(vault);
        isVault[vault] = true;

        uint256 deposit = msg.value - setupFee;
        if (setupFee > 0) _pay(treasury, setupFee);
        if (deposit > 0) _pay(vault, deposit);
        emit VaultCreated(vault, msg.sender, heir, window, deposit);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    function vaultsOf(address owner) external view returns (address[] memory) {
        return _byOwner[owner];
    }

    /// @notice Vaults that named this address as heir at creation (a later setHeir is read from the vault itself).
    function vaultsForHeir(address heir) external view returns (address[] memory) {
        return _byHeir[heir];
    }

    function _pay(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
