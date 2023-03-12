// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

error RossRaffle__NotEnoughETHEntered;


contract RossRaffle {
    /* state variables */
    uint256 private immutable i_entranceFee;
    address payable[] private s_players;
    
    /* events */
    event raffleEnter(address indexed player);

    constructor(uint256 entranceFee) {
        i_entranceFee = entranceFee;
    }

    function getEntranceFee() public view returns (uint256) {
        return i_entranceFee;
    }

    function getPlayer(uint256 index) public view returns(address) {
        return s_players(index)
    }

    function enterRaffle() public payable {
        if (msg.value < i_entranceFee) {
            revert RossRaffle__NotEnoughETHEntered();
        }
        s_players.push(payable(msg.sender));
        emit raffleEnter(msg.sender);
    }

    //function pickRandomWinner() {}
}
