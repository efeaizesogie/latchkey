// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Tap02Processor (TESTNET ONLY)
/// @notice TapeOut is deployed on X Layer mainnet only. So that people can try Latchkey for free on X Layer testnet,
///         this contract stands in for a TapeOut processor: it stores TAP-02 netlists and evaluates them with the same
///         read interface Latchkey uses (`circuitInfo`, `netlist`, `eval`, `step`, `ownerOf`), following TAP-02 §2–§5
///         (NAND, LATCH, REF to circuits on this contract, LSB-first bit packing, lenient input reading).
///         The fork test checks it against TapeOut's real OrderGuard processor on all 256 rows of the latch.
///         It does not mint transistors, charge fees or implement ERC-721 transfers; mainnet uses TapeOut itself.
contract Tap02Processor {
    struct Circuit {
        bytes netlist;
        uint32 nIn;
        uint32 nOut;
        uint32 nState;
        uint32 gateCount;
        uint32 nSignals;
        address owner;
    }

    mapping(uint256 => Circuit) internal _c;
    uint256 public nextId = 1;
    uint256 internal constant MAX_SIGNALS = 4096; // plenty for Latchkey; keeps evaluation cheap

    event TapedOut(uint256 indexed circuitId, address indexed author, uint32 gateCount, uint32 nState);

    function tapeout(bytes calldata nl, uint32 nIn, uint32 nOut) external payable returns (uint256 id) {
        require(nOut >= 1, "no outputs");
        (uint32 nState, uint32 gates, uint32 S) = _analyze(nl, nIn);
        require(2 + nIn + nOut <= S, "too few signals for outputs");
        id = nextId++;
        _c[id] = Circuit(nl, nIn, nOut, nState, gates, S, msg.sender);
        emit TapedOut(id, msg.sender, gates, nState);
    }

    function circuitInfo(uint256 id) external view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount) {
        Circuit storage c = _c[id];
        require(c.owner != address(0), "no circuit");
        return (c.nIn, c.nOut, c.nState, c.gateCount);
    }

    function netlist(uint256 id) external view returns (bytes memory) {
        require(_c[id].owner != address(0), "no circuit");
        return _c[id].netlist;
    }

    function ownerOf(uint256 id) external view returns (address) {
        require(_c[id].owner != address(0), "no circuit");
        return _c[id].owner;
    }

    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory) {
        Circuit storage c = _c[id];
        require(c.owner != address(0), "no circuit");
        require(c.nState == 0, "has latch: use step");
        (, bool[] memory outs) = _beat(id, new bool[](0), _unpack(inputs, c.nIn));
        return _pack(outs);
    }

    function step(uint256 id, bytes calldata state, bytes calldata inputs)
        external
        view
        returns (bytes memory newState, bytes memory outputs)
    {
        Circuit storage c = _c[id];
        require(c.owner != address(0), "no circuit");
        (bool[] memory ns, bool[] memory outs) = _beat(id, _unpack(state, c.nState), _unpack(inputs, c.nIn));
        return (_pack(ns), _pack(outs));
    }

    // ------------------------------------------------------------------ TAP-02 §3 checks

    function _u24(bytes calldata b, uint256 k) internal pure returns (uint256) {
        return (uint256(uint8(b[k])) << 16) | (uint256(uint8(b[k + 1])) << 8) | uint256(uint8(b[k + 2]));
    }

    function _analyze(bytes calldata nl, uint32 nIn) internal view returns (uint32 nState, uint32 gates, uint32 S) {
        uint256 sig = 2 + uint256(nIn);
        uint256 i;
        uint256[] memory latchD = new uint256[](nl.length / 4 + 1);
        uint256 nLatch;
        while (i < nl.length) {
            uint8 op = uint8(nl[i]);
            if (op == 0x00) {
                require(i + 7 <= nl.length, "truncated");
                require(_u24(nl, i + 1) < sig && _u24(nl, i + 4) < sig, "NAND: future signal");
                sig += 1;
                gates += 1;
                i += 7;
            } else if (op == 0x01) {
                require(i + 4 <= nl.length, "truncated");
                latchD[nLatch++] = _u24(nl, i + 1);
                sig += 1;
                nState += 1;
                gates += 1;
                i += 4;
            } else if (op == 0x02) {
                (uint256 len, uint256 nOuts, uint32 subState, uint32 subGates) = _checkRef(nl, i, sig);
                sig += nOuts;
                nState += subState;
                gates += subGates;
                i += len;
            } else {
                revert("bad opcode");
            }
        }
        for (uint256 k; k < nLatch; ++k) require(latchD[k] < sig, "LATCH d out of range");
        require(sig <= MAX_SIGNALS, "too large for the testnet evaluator");
        S = uint32(sig);
    }

    function _checkRef(bytes calldata nl, uint256 i, uint256 sig)
        internal
        view
        returns (uint256 len, uint256 nOuts, uint32 subState, uint32 subGates)
    {
        require(i + 31 <= nl.length, "truncated");
        require(address(bytes20(nl[i + 1:i + 21])) == address(this), "REF: target not a registered CPU");
        Circuit storage t = _c[uint256(uint64(bytes8(nl[i + 21:i + 29])))];
        uint256 nIns = uint8(nl[i + 29]);
        nOuts = uint8(nl[i + 30]);
        len = 31 + 3 * nIns;
        require(i + len <= nl.length, "truncated");
        require(t.owner != address(0), "no circuit");
        require(t.nIn == nIns && t.nOut == nOuts, "REF: pin mismatch");
        for (uint256 k; k < nIns; ++k) require(_u24(nl, i + 31 + 3 * k) < sig, "REF: future signal");
        return (len, nOuts, t.nState, t.gateCount);
    }

    // ------------------------------------------------------------------ TAP-02 §4 one beat

    /// @dev Working state of one beat, kept in memory to stay within the EVM stack.
    struct Beat {
        bool[] s; // signals
        bool[] st; // state in
        bool[] ns; // state out
        uint256 sig; // next signal index
        uint256 si; // next state bit
    }

    function _beat(uint256 id, bool[] memory st, bool[] memory ins) internal view returns (bool[] memory, bool[] memory outs) {
        Circuit storage c = _c[id];
        bytes memory nl = c.netlist;
        Beat memory b = Beat(new bool[](c.nSignals), st, new bool[](c.nState), 2 + uint256(c.nIn), 0);
        b.s[1] = true;
        for (uint256 k; k < c.nIn; ++k) b.s[2 + k] = ins[k];
        uint256[] memory dOf = new uint256[](c.nState); // LATCH d per state bit (+1, so 0 marks REF bits)
        uint256 i;
        while (i < nl.length) {
            uint8 op = uint8(nl[i]);
            if (op == 0x00) {
                b.s[b.sig++] = !(b.s[_m24(nl, i + 1)] && b.s[_m24(nl, i + 4)]);
                i += 7;
            } else if (op == 0x01) {
                b.s[b.sig++] = b.st[b.si];
                dOf[b.si++] = _m24(nl, i + 1) + 1;
                i += 4;
            } else {
                i += _refBeat(nl, i, b);
            }
        }
        for (uint256 k; k < c.nState; ++k) if (dOf[k] != 0) b.ns[k] = b.s[dOf[k] - 1];
        outs = new bool[](c.nOut);
        for (uint256 k; k < c.nOut; ++k) outs[k] = b.s[c.nSignals - c.nOut + k];
        return (b.ns, outs);
    }

    /// @dev One REF record: run the referenced circuit's beat on its slice of state, write its outputs into the
    ///      signals and its new state into the state out. Returns the record length.
    function _refBeat(bytes memory nl, uint256 i, Beat memory b) internal view returns (uint256) {
        uint256 sub;
        for (uint256 k = 21; k < 29; ++k) sub = (sub << 8) | uint8(nl[i + k]);
        uint256 nIns = uint8(nl[i + 29]);
        bool[] memory subIns = new bool[](nIns);
        for (uint256 k; k < nIns; ++k) subIns[k] = b.s[_m24(nl, i + 31 + 3 * k)];
        uint256 subN = _c[sub].nState;
        bool[] memory subSt = new bool[](subN);
        for (uint256 k; k < subN; ++k) subSt[k] = b.st[b.si + k];
        (bool[] memory subNs, bool[] memory subOuts) = _beat(sub, subSt, subIns);
        for (uint256 k; k < subOuts.length; ++k) b.s[b.sig++] = subOuts[k];
        for (uint256 k; k < subN; ++k) b.ns[b.si + k] = subNs[k];
        b.si += subN;
        return 31 + 3 * nIns;
    }

    function _m24(bytes memory b, uint256 k) internal pure returns (uint256) {
        return (uint256(uint8(b[k])) << 16) | (uint256(uint8(b[k + 1])) << 8) | uint256(uint8(b[k + 2]));
    }

    // ------------------------------------------------------------------ TAP-02 §5 packing

    function _unpack(bytes calldata b, uint256 n) internal pure returns (bool[] memory out) {
        out = new bool[](n);
        for (uint256 k; k < n; ++k) {
            uint256 byteIx = k >> 3;
            if (byteIx < b.length) out[k] = (uint8(b[byteIx]) >> (k & 7)) & 1 == 1;
        }
    }

    function _pack(bool[] memory bits) internal pure returns (bytes memory out) {
        out = new bytes((bits.length + 7) / 8);
        for (uint256 k; k < bits.length; ++k) if (bits[k]) out[k >> 3] = bytes1(uint8(out[k >> 3]) | uint8(1 << (k & 7)));
    }
}
