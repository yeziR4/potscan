// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VerificationRegistry
/// @notice Public record that a deployed contract's code was built from published source.
///         Anyone may attest; readers decide which attesters they trust. An attestation is bound to the code hash
///         the chain reports for the target at attestation time, so it stops counting if that code ever changes.
contract VerificationRegistry {
    struct Attestation {
        /// Code hash of the target when attested, as read on chain.
        bytes32 codeHash;
        /// keccak256 of the compiler input (sources and settings), so anyone can rebuild and compare.
        bytes32 sourceHash;
        /// For example "resolc 1.4.0, solc 0.8.30".
        string compiler;
        /// Where the source can be read.
        string sourceUri;
        uint64 attestedAt;
    }

    mapping(address attester => mapping(address target => Attestation)) private attestations;

    event Verified(
        address indexed attester,
        address indexed target,
        bytes32 indexed codeHash,
        bytes32 sourceHash,
        string compiler,
        string sourceUri
    );
    event Revoked(address indexed attester, address indexed target);

    error NotAContract(address target);
    error NothingToRevoke(address target);

    /// @notice Records that `target`'s current code was built from the source identified by `sourceHash`.
    function attest(address target, bytes32 sourceHash, string calldata compiler, string calldata sourceUri) external {
        bytes32 codeHash = target.codehash;
        if (codeHash == bytes32(0) || codeHash == keccak256("")) revert NotAContract(target);

        attestations[msg.sender][target] =
            Attestation(codeHash, sourceHash, compiler, sourceUri, uint64(block.timestamp));
        emit Verified(msg.sender, target, codeHash, sourceHash, compiler, sourceUri);
    }

    /// @notice Withdraws the caller's attestation for `target`.
    function revoke(address target) external {
        if (attestations[msg.sender][target].codeHash == bytes32(0)) revert NothingToRevoke(target);
        delete attestations[msg.sender][target];
        emit Revoked(msg.sender, target);
    }

    /// @notice The attestation `attester` made for `target`, empty if there is none.
    function attestationOf(address attester, address target) external view returns (Attestation memory) {
        return attestations[attester][target];
    }

    /// @notice True when `attester` vouched for `target` and the target still runs the code that was attested.
    function isVerified(address attester, address target) external view returns (bool) {
        bytes32 attested = attestations[attester][target].codeHash;
        return attested != bytes32(0) && attested == target.codehash;
    }
}
