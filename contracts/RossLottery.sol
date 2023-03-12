// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/interfaces/KeeperCompatibleInterface.sol";

error RossRaffle__NotEnoughETHEntered();
error RossRaffle__TransferFailed();
error RossRaffle__NotOpen();
error RossRaffle_UpkeepNotNeeded(uint256 currentBalance, uint256 numplayers, uint256 raffleState);

contract RossRaffle is VRFConsumerBaseV2, KeeperCompatibleInterface {
    /* Types */
    enum RaffleState {
        OPEN,
        CALCULATING
    }

    /* state variables */
    uint256 private immutable i_entranceFee;
    address payable[] private s_players;
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    bytes32 private immutable i_gasLane;
    uint64 private immutable i_subscriptionId;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private immutable i_callbackGasLimit;
    uint16 private constant NUM_WORDS = 1;

    RaffleState private s_raffleState;
    uint256 private s_lastTimeStamp; // last block
    uint256 private i_interval;

    // lottery vars
    address private s_recentWinner;

    /* events */
    event RaffleEnter(address indexed player);
    event RequestedRaffleWinner(uint256 indexed requestId);
    event WinnerPicked(address indexed winner);

    // main constructor needs to include the address param that the secondary constructor
    constructor(
        address vrfCoordinatorV2, //contract address.  this is a tip that we'll need to implement a MOCK if we want to do testing
        uint256 entranceFee,
        bytes32 gasLane,
        uint64 subscriptionId,
        uint32 callbackGasLimit,
        uint256 interval
    ) VRFConsumerBaseV2(vrfCoordinatorV2) {
        i_entranceFee = entranceFee;
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2); // wrap the address in the coordinator interface
        i_gasLane = gasLane;
        i_subscriptionId = subscriptionId;
        i_callbackGasLimit = callbackGasLimit;

        s_raffleState = RaffleState.OPEN;
        s_lastTimeStamp = block.timestamp;
        i_interval = interval;
    }

    /* functions */
    function enterRaffle() public payable {
        if (msg.value < i_entranceFee) {
            revert RossRaffle__NotEnoughETHEntered();
        }
        if (s_raffleState != RaffleState.OPEN) {
            revert RossRaffle__NotOpen();
        }
        s_players.push(payable(msg.sender));
        emit RaffleEnter(msg.sender);
    }

    // REPLACED BY PERFORMUPKEEP
    /*function requestRandomWinner() internal {
        s_raffleState = RaffleState.CALCULATING;
        // request the random number
        //  we need to use requestRandomWords() which is in the VRFCoordinatorV2Interface contract
        //  which means we need to get that [go to constructor and establish the coordinator object]
        //      this returns a uint256 request ID
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_gasLane, // the "gas lane" which we can use to reduce gas costs.  we set this up in constructor.  called keyHash in docs.
            i_subscriptionId, // the subscription that we need for funding our requests.  there's a contract on chain that does this for us.  we make requests to subscriptions
            REQUEST_CONFIRMATIONS, //requestConfirmations,   // uint16 - how many confirmations we should wait before responding.  constant!
            i_callbackGasLimit, // uint32 limit for how much gas to use for the callback request to use to fulfillrandomwords.  protects us from spaffing loads by accidents
            NUM_WORDS // how many random numbers we want
        );
        emit RequestedRaffleWinner(requestId); //emit an event to track this

        // once we get the random number, pick a winner from our array of participants
        // it's a 2 transaction process which helps us avoid brute forcing issues
    }*/

    // this version is external so we need to do more validation
    function performUpkeep(bytes memory /*performData*/) external override {
        (bool upkeepNeeded, ) = checkUpkeep("");
        if (!upkeepNeeded) {
            revert RossRaffle_UpkeepNotNeeded(address(this).balance, s_players.length, uint256(s_raffleState)); // for some error checking
        }

        s_raffleState = RaffleState.CALCULATING;
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_gasLane,
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            i_callbackGasLimit,
            NUM_WORDS
        );
        emit RequestedRaffleWinner(requestId);
    }

    /**
     * this is a function that chainlink keeper nodes call on a regular basis
     * they expect it to return true
     * when true, we do a new random winner
     * *** for this to work, our contract needs to be in an "open" state
     * *** so we are not in the middle of a previous lottery
     */
    function checkUpkeep(
        bytes memory /*checkData*/
    ) public view override returns (bool upkeepNeeded, bytes memory something) {
        bool isOpen = (s_raffleState == RaffleState.OPEN);
        bool timePassed = ((block.timestamp - s_lastTimeStamp) > i_interval);
        bool hasPlayers = (s_players.length > 0);
        bool hasBalance = (address(this).balance > 0);

        // time to end the lottery!
        //return (isOpen && timePassed && hasPlayers && hasBalance);
        upkeepNeeded = (isOpen && timePassed && hasPlayers && hasBalance); // auto returns upkeepNeeded?
    }

    //randomWords will be size 1 for us, since that's all we requested in NUM_WORDS
    function fulfillRandomWords(uint256 /*requestId*/, uint256[] memory randomWords) internal override {
        // example: s_players is size 10 and our random n is 207
        // 207 % 10 -> 7
        // so the modulus will always give us a number from 0 to (size of array of participants - 1)
        // which is perfect for picking a random winner from our array
        uint256 n = randomWords[0] % s_players.length;
        address payable recentWinner = s_players[n];
        s_recentWinner = recentWinner;

        s_raffleState = RaffleState.OPEN;
        s_players = new address payable[](0);
        s_lastTimeStamp = block.timestamp;

        (bool success, ) = recentWinner.call{value: address(this).balance}("");
        if (!success) {
            revert RossRaffle__TransferFailed();
        }
        emit WinnerPicked(recentWinner);
    }

    /* views and getters */
    function getEntranceFee() public view returns (uint256) {
        return i_entranceFee;
    }

    function getPlayer(uint256 index) public view returns (address) {
        return s_players[index];
    }

    function getRecentWinner() public view returns (address) {
        return s_recentWinner;
    }

    function getRaffleState() public view returns (RaffleState) {
        return s_raffleState;
    }

    // this isn't reading from storage - it's a constant so it's in the ABI
    // so we can use PURE instead of VIEW to save gas
    function getNumWords() public pure returns (uint256) {
        return NUM_WORDS;
    }

    function getInterval() public view returns (uint256) {
        return i_interval;
    }
}
