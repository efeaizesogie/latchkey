// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestUSD (TESTNET ONLY)
/// @notice A worthless 6-decimal dollar for trying Latchkey on X Layer testnet. Anyone can take 1,000 per hour.
contract TestUSD is ERC20 {
    uint256 public constant DRIP = 1_000 * 1e6;
    uint256 public constant COOLDOWN = 1 hours;
    mapping(address => uint256) public lastDrip;

    error TooSoon(uint256 nextAt);

    constructor() ERC20("Latchkey Test USD", "tUSDT0") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet() external {
        uint256 next = lastDrip[msg.sender] + COOLDOWN;
        if (lastDrip[msg.sender] != 0 && block.timestamp < next) revert TooSoon(next);
        lastDrip[msg.sender] = block.timestamp;
        _mint(msg.sender, DRIP);
    }
}
