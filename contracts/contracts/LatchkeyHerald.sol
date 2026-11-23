// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ILatchkeyHerald} from "./LatchkeyVault.sol";

/// @notice TapeSend hub (TapeKit send/contracts/DeWebHub.sol), the DeWEB messaging layer of TAP-10.
interface IDeWebHub {
    function send(address circuits, uint256 tokenId, bytes32 to, bytes32 ref, bytes calldata payload)
        external
        returns (uint256 inboxIndex);
}

/// @notice SiteRegistry (TAP-10 site store): the holder can authorise an operator to update the site files.
interface ISiteRegistry {
    function setOperator(address container, address op, uint256 ttl) external;
}

interface IFactoryVaults {
    function isVault(address) external view returns (bool);
}

interface IERC721Owner {
    function ownerOf(uint256) external view returns (address);
}

/// @title LatchkeyHerald
/// @notice Holds Latchkey's own TapeOut circuit NFT. That circuit's ERC-6551 container is one address with two roles
///         (TAP-10): it stores the Latchkey website on DeWEB, and it is Latchkey's TapeSend endpoint.
///         Vaults made by the factory call the herald when a grace period starts or a latch trips, and the herald sends
///         a public TapeSend message as Latchkey's container: to the owner's or heir's inbox when they gave one, or to
///         Latchkey's own inbox, which serves as a public on-chain feed.
///
///         The herald can only send fixed messages composed from vault state; it holds no funds. The admin can only
///         name a site operator (to publish app updates to DeWEB) and can renounce; a vault never depends on the herald.
contract LatchkeyHerald is ILatchkeyHerald {

    IDeWebHub public immutable hub;
    address public immutable processor; // the circuit's processor ("circuits" contract)
    uint256 public immutable circuitId; // Latchkey's own circuit (its container hosts the site)
    address public immutable container; // that circuit's ERC-6551 container
    ISiteRegistry public immutable sites;
    string public tapeName; // e.g. "27.2.272.tape"

    address public factory;
    address public admin;
    uint256 public sent;

    bytes4 internal constant PUBLIC_V2 = 0x54530200; // "TS", payload format 0x02, public (TAP-10 §15.2)

    event Announced(uint8 indexed kind, bytes32 indexed to, uint256 inboxIndex);
    event AdminChanged(address admin);

    error NotAdmin();
    error NotVault();
    error FactorySet();

    constructor(
        IDeWebHub hub_,
        address processor_,
        uint256 circuitId_,
        address container_,
        ISiteRegistry sites_,
        string memory tapeName_,
        address admin_
    ) {
        hub = hub_;
        processor = processor_;
        circuitId = circuitId_;
        container = container_;
        sites = sites_;
        tapeName = tapeName_;
        admin = admin_;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /// @notice One-time wiring to the factory whose vaults may call the herald.
    function setFactory(address factory_) external onlyAdmin {
        if (factory != address(0)) revert FactorySet();
        factory = factory_;
    }

    /// @notice Let `op` update the DeWEB site for `ttl` seconds (the herald is the circuit's holder).
    function setSiteOperator(address op, uint256 ttl) external onlyAdmin {
        sites.setOperator(container, op, ttl);
    }

    function setAdmin(address admin_) external onlyAdmin {
        admin = admin_; // address(0) renounces for good
        emit AdminChanged(admin_);
    }

    /// @notice True once the herald holds the circuit it speaks for.
    function ready() public view returns (bool) {
        try IERC721Owner(processor).ownerOf(circuitId) returns (address o) {
            return o == address(this);
        } catch {
            return false;
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ------------------------------------------------------------------ messages

    modifier onlyVault() {
        if (factory == address(0) || !IFactoryVaults(factory).isVault(msg.sender)) revert NotVault();
        _;
    }

    function graceStarted(address owner, address heir, address ownerInbox, uint64 tripsAt) external onlyVault {
        string memory vault = _hex(msg.sender);
        string memory body = string.concat(
            "Your Latchkey vault ",
            vault,
            " has not seen a check-in for its whole window, so its grace period has started. If you are fine, check in before ",
            _dec(tripsAt),
            " (unix time) and nothing happens. Otherwise the latch trips and ",
            _hex(heir),
            " can claim it. Owner: ",
            _hex(owner),
            "."
        );
        _post(1, ownerInbox, "Latchkey: check in to keep your vault", body, vault);
    }

    function tripped(address heir, address heirInbox) external onlyVault {
        string memory vault = _hex(msg.sender);
        string memory body = string.concat(
            "The latch of Latchkey vault ",
            vault,
            " has tripped, decided by its TapeOut circuit. It can never be reopened. Only ",
            _hex(heir),
            " can claim what is inside: connect that wallet on the vault page."
        );
        _post(2, heirInbox, "Latchkey: a vault has opened for you", body, vault);
    }

    function _post(uint8 kind, address inbox, string memory subject, string memory body, string memory vault) internal {
        string memory link = bytes(tapeName).length > 0 ? string.concat(" tape://", tapeName, "/#/v/", vault) : "";
        // TAP-10 content object (all values are fixed text, hex and digits: nothing to escape)
        bytes memory json = abi.encodePacked(
            '{"v":1,"kind":"message","subject":"', subject, '","body":"', body, link, '","ts":', _dec(block.timestamp), "}"
        );
        bytes32 to = _endpoint(inbox == address(0) ? container : inbox);
        uint256 idx = hub.send(processor, circuitId, to, bytes32(0), abi.encodePacked(PUBLIC_V2, json));
        unchecked {
            ++sent;
        }
        emit Announced(kind, to, idx);
    }

    function _hex(address a) internal pure returns (string memory) {
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        uint160 v = uint160(a);
        for (uint256 i = 41; i > 1; --i) {
            out[i] = bytes1(uint8(bytes16("0123456789abcdef")[v & 15]));
            v >>= 4;
        }
        return string(out);
    }

    function _dec(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 len;
        for (uint256 t = v; t != 0; t /= 10) ++len;
        bytes memory out = new bytes(len);
        for (; v != 0; v /= 10) out[--len] = bytes1(uint8(48 + (v % 10)));
        return string(out);
    }

    /// @dev TAP-10 endpoint ID: uint32(0) ‖ uint64(chainId) ‖ container.
    function _endpoint(address c) internal view returns (bytes32) {
        return bytes32((uint256(block.chainid) << 160) | uint256(uint160(c)));
    }
}
