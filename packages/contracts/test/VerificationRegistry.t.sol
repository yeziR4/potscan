// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VerificationRegistry} from "../src/VerificationRegistry.sol";

contract Target {
    function ping() external pure returns (uint256) {
        return 1;
    }
}

contract VerificationRegistryTest is Test {
    VerificationRegistry registry;
    Target target;
    address attester = makeAddr("attester");
    address other = makeAddr("other");
    bytes32 constant SOURCE = keccak256("compiler input");

    event Verified(
        address indexed attester,
        address indexed target,
        bytes32 indexed codeHash,
        bytes32 sourceHash,
        string compiler,
        string sourceUri
    );

    function setUp() public {
        registry = new VerificationRegistry();
        target = new Target();
    }

    function attest() internal {
        vm.prank(attester);
        registry.attest(address(target), SOURCE, "resolc 1.4.0", "https://potscan.example/source/1");
    }

    function test_attest_recordsTheCodeHashReadOnChain() public {
        vm.expectEmit(address(registry));
        emit Verified(
            attester,
            address(target),
            address(target).codehash,
            SOURCE,
            "resolc 1.4.0",
            "https://potscan.example/source/1"
        );
        attest();

        VerificationRegistry.Attestation memory a = registry.attestationOf(attester, address(target));
        assertEq(a.codeHash, address(target).codehash);
        assertEq(a.sourceHash, SOURCE);
        assertEq(a.compiler, "resolc 1.4.0");
        assertEq(a.attestedAt, block.timestamp);
        assertTrue(registry.isVerified(attester, address(target)));
    }

    function test_attestations_areScopedToTheAttester() public {
        attest();
        assertFalse(registry.isVerified(other, address(target)));
        assertEq(registry.attestationOf(other, address(target)).codeHash, bytes32(0));
    }

    function test_attest_rejectsAnAccountWithoutCode() public {
        vm.expectRevert(abi.encodeWithSelector(VerificationRegistry.NotAContract.selector, other));
        vm.prank(attester);
        registry.attest(other, SOURCE, "resolc 1.4.0", "");
    }

    function test_isVerified_stopsCountingWhenTheCodeChanges() public {
        attest();
        vm.etch(address(target), hex"6001600055");
        assertFalse(registry.isVerified(attester, address(target)));
    }

    function test_reattesting_replacesThePreviousRecord() public {
        attest();
        vm.prank(attester);
        registry.attest(address(target), keccak256("new input"), "resolc 1.5.0", "uri-2");
        VerificationRegistry.Attestation memory a = registry.attestationOf(attester, address(target));
        assertEq(a.sourceHash, keccak256("new input"));
        assertEq(a.compiler, "resolc 1.5.0");
    }

    function test_revoke_removesOnlyTheCallersAttestation() public {
        attest();
        vm.prank(other);
        registry.attest(address(target), SOURCE, "resolc 1.4.0", "");

        vm.prank(attester);
        registry.revoke(address(target));
        assertFalse(registry.isVerified(attester, address(target)));
        assertTrue(registry.isVerified(other, address(target)));
    }

    function test_revoke_withoutAnAttestationReverts() public {
        vm.expectRevert(abi.encodeWithSelector(VerificationRegistry.NothingToRevoke.selector, address(target)));
        vm.prank(attester);
        registry.revoke(address(target));
    }
}
