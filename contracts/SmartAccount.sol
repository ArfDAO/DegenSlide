// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SmartAccount {
    address public owner;
    
    struct SessionKey {
        uint256 validUntil;
        uint256 maxSpend;
        uint256 spent;
        bool active;
    }

    mapping(address => SessionKey) public sessionKeys;
    mapping(bytes32 => bool) public executedHashes;
    uint256 public nonce;

    event SessionKeyUpdated(address indexed key, bool active, uint256 validUntil, uint256 maxSpend);
    event TransactionExecuted(address indexed dest, uint256 value, bytes data);

    modifier onlyOwner() {
        require(msg.sender == owner, "SmartAccount: only owner");
        _;
    }

    constructor(address _owner) {
        owner = _owner;
    }

    receive() external payable {}

    // Allow owner to execute any transaction
    function execute(address dest, uint256 value, bytes calldata data) external onlyOwner returns (bytes memory) {
        return _execute(dest, value, data);
    }

    // Set or revoke a session key
    function setSessionKey(address _key, uint256 _validUntil, uint256 _maxSpend) external onlyOwner {
        sessionKeys[_key] = SessionKey({
            validUntil: _validUntil,
            maxSpend: _maxSpend,
            spent: 0,
            active: true
        });
        emit SessionKeyUpdated(_key, true, _validUntil, _maxSpend);
    }

    function revokeSessionKey(address _key) external onlyOwner {
        sessionKeys[_key].active = false;
        emit SessionKeyUpdated(_key, false, 0, 0);
    }

    // Direct execution by an authorized session key (Session Key pays gas)
    function executeBySession(address dest, uint256 value, bytes calldata data) external returns (bytes memory) {
        SessionKey storage key = sessionKeys[msg.sender];
        require(key.active, "SmartAccount: session key not active");
        require(block.timestamp <= key.validUntil, "SmartAccount: session key expired");
        require(key.spent + value <= key.maxSpend, "SmartAccount: session key budget exceeded");

        key.spent += value;
        return _execute(dest, value, data);
    }

    // Relayed execution using a signature from the session key (Relayer/Keeper pays gas)
    function executeWithSig(
        address dest,
        uint256 value,
        bytes calldata data,
        address sessionKey,
        uint256 _nonce,
        bytes calldata signature
    ) external returns (bytes memory) {
        require(_nonce == nonce, "SmartAccount: invalid nonce");
        
        SessionKey storage key = sessionKeys[sessionKey];
        require(key.active, "SmartAccount: session key not active");
        require(block.timestamp <= key.validUntil, "SmartAccount: session key expired");
        require(key.spent + value <= key.maxSpend, "SmartAccount: session key budget exceeded");

        // Verify signature from the session key
        bytes32 messageHash = getMessageHash(dest, value, data, sessionKey, _nonce);
        bytes32 ethSignedMessageHash = getEthSignedMessageHash(messageHash);
        
        address signer = recoverSigner(ethSignedMessageHash, signature);
        require(signer == sessionKey, "SmartAccount: invalid signature");

        nonce++;
        key.spent += value;
        return _execute(dest, value, data);
    }

    function getMessageHash(
        address _dest,
        uint256 _value,
        bytes calldata _data,
        address _sessionKey,
        uint256 _nonce
    ) public view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this), _dest, _value, _data, _sessionKey, _nonce));
    }

    function getEthSignedMessageHash(bytes32 _messageHash) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", _messageHash));
    }

    function recoverSigner(bytes32 _ethSignedMessageHash, bytes memory _signature) public pure returns (address) {
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(_signature);
        return ecrecover(_ethSignedMessageHash, v, r, s);
    }

    function splitSignature(bytes memory sig) public pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(sig.length == 65, "SmartAccount: invalid signature length");
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
    }

    function _execute(address dest, uint256 value, bytes calldata data) internal returns (bytes memory) {
        (bool success, bytes memory result) = dest.call{value: value}(data);
        require(success, "SmartAccount: transaction failed");
        emit TransactionExecuted(dest, value, data);
        return result;
    }
}
