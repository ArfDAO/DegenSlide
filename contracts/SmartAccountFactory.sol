// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SmartAccount.sol";

contract SmartAccountFactory {
    mapping(address => address) public getSmartAccount;
    address[] public allAccounts;

    event AccountCreated(address indexed owner, address accountAddress);

    function createAccount() external returns (address) {
        require(getSmartAccount[msg.sender] == address(0), "SmartAccountFactory: account already exists");

        SmartAccount newAccount = new SmartAccount(msg.sender);
        address accountAddr = address(newAccount);
        
        getSmartAccount[msg.sender] = accountAddr;
        allAccounts.push(accountAddr);

        emit AccountCreated(msg.sender, accountAddr);
        return accountAddr;
    }

    function getAccountsCount() external view returns (uint256) {
        return allAccounts.length;
    }
}
