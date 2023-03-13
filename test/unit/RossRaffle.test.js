const { assert, expect } = require("chai")
const { network, getNamedAccounts, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("RossRaffle", async function () {
          let rossRaffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval, accountConnectedRaffle, accounts
          const chainId = network.config.chainId

          beforeEach(async function () {
              //const { deployer } = await getNamedAccounts()
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"]) //deploy everything (see the module exported tags!)
              rossRaffle = await ethers.getContract("RossRaffle", deployer) //connect it with our deployer
              accountConnectedRaffle = rossRaffle.connect(deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              raffleEntranceFee = await rossRaffle.getEntranceFee()
              interval = await rossRaffle.getInterval()
          })

          describe("constructor", function () {
              it("Initialises the raffle contract properly", async function () {
                  //normally 1 assert per 'it' is good practice
                  const raffleState = await rossRaffle.getRaffleState()
                  const interval = await rossRaffle.getInterval()
                  assert.equal(raffleState.toString(), "0") // 0 is open in the contract remember
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"]) // should match what's in our helper config
              })
          })

          describe("enterRaffle", function () {
              it("Reverts when you don't pay enough to enter", async function () {
                  await expect(rossRaffle.enterRaffle()).to.be.revertedWith("RossRaffle__NotEnoughETHEntered") // our own error!
              })
              it("Records ppl when they enter", async function () {
                  await rossRaffle.enterRaffle({ value: raffleEntranceFee })
                  const playerFromContract = await rossRaffle.getPlayer(0) // check we're the deployer
                  assert.equal(playerFromContract, deployer)
              })
              it("emits an event on raffle enter", async function () {
                  await expect(rossRaffle.enterRaffle({ value: raffleEntranceFee })).to.emit(rossRaffle, "RaffleEnter") // a waffle matcher for when we expect an event emitted
              })
              it("doesn't let us enter when raffle is calculating", async function () {
                  await rossRaffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", []) // these 3 lines all make performUpkeep return true
                  // now we pretend to be chainlink keeper
                  await rossRaffle.performUpkeep([])
                  await expect(rossRaffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "RossRaffle__NotOpen"
                  )
              })
          })

          describe("checkUpkeep", function () {
              it("returns false if people haven't sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", []) //auto 1 block
                  const { upkeepNeeded } = await rossRaffle.callStatic.checkUpkeep([])
                  assert(!upkeepNeeded) // it should return false for this test to pass
              })
              it("returns false if raffle state isn't open", async function () {
                  await rossRaffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", []) //auto 1 block
                  await rossRaffle.performUpkeep("0x") // hardhat knows to make 0x a blank bytes object
                  const raffleState = await rossRaffle.getRaffleState()
                  const { upkeepNeeded } = await rossRaffle.callStatic.checkUpkeep("0x")
                  assert.equal(raffleState.toString(), "1")
                  assert.equal(upkeepNeeded, false)
              })
          })

          describe("performUpkeep", function () {
              it("can only run if checkUpkeep is true", async function () {
                  await rossRaffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const tx = await rossRaffle.performUpkeep("0x")
                  assert(tx) // if it doesn't work, tx won't be asserted
              })
              it("reverts when checkUpkeep is false", async function () {
                  await expect(rossRaffle.performUpkeep([])).to.be.revertedWith("RossRaffle_UpkeepNotNeeded") // this error actually returns a bunch of stuff
                  //await expect(rossRaffle.performUpkeep([])).to.be.revertedWith(`RossRaffle_UpkeepNotNeeded()`) // string interpolation can be used to show the params
              })
              it("updates raffle stat, emits an event, and calls the vrf coordinator", async function () {
                  await rossRaffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const txResponse = await rossRaffle.performUpkeep("0x")
                  const txReceipt = await txResponse.wait(1)
                  const requestId = txReceipt.events[1].args.requestId // we can get this from our emit in our contract, but we can also get it direct from the VRF coordinator
                  // get the first event, not the zeroth event.  because a different function emits first.
                  const raffleState = await rossRaffle.getRaffleState()
                  assert(requestId.toNumber() > 0)
                  assert(raffleState.toString() == "1")
              })
          })

          describe("fulfillRandomWords", function () {
              beforeEach(async function () {
                  await rossRaffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
              })
              it("can only be called after performUpkeep", async function () {
                  await expect(vrfCoordinatorV2Mock.fulfillRandomWords(0, rossRaffle.address)).to.be.revertedWith(
                      "nonexistent request"
                  ) //guess 0 as the requestId (first param)
                  await expect(vrfCoordinatorV2Mock.fulfillRandomWords(1, rossRaffle.address)).to.be.revertedWith(
                      "nonexistent request"
                  ) // we don't want to test every requestId
                  // we might use fuzzing to test it later
              })

              //big ol test
              it("picks a winner, resets the lottery, and sends money", async function () {
                  const additionalEntrants = 3 // 3 fake accounts to enter the lottery
                  const startingAccountIndex = 2 // since deployer is 0
                  accounts = await ethers.getSigners() //getSigners returns a list of accounts connected to the node

                  for (let i = startingAccountIndex; i < startingAccountIndex + additionalEntrants; i++) {
                      accountConnectedRaffle = rossRaffle.connect(accounts[i]) // declare accounts first!  returns new contract isntance connected to player
                      await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee })
                  }
                  const startingTimeStamp = await rossRaffle.getLastTimeStamp() //the time of the last block

                  // declare async func with 2 params
                  await new Promise(async (resolve, reject) => {
                      // once the specified event happens
                      // essentially make a listener that will wait asynchronously for the code below, with performupkeep etc
                      rossRaffle.once("WinnerPicked", async () => {
                          console.log("found the event!  a winner has been picked")
                          try {
                              const recentWinner = await rossRaffle.getRecentWinner()
                              console.log(recentWinner)
                              console.log(accounts[0].address)
                              console.log(accounts[1].address)
                              console.log(accounts[2].address)
                              console.log(accounts[3].address)

                              const raffleState = await rossRaffle.getRaffleState()
                              const endingTimeStamp = await rossRaffle.getLastTimeStamp()
                              const numPlayers = await rossRaffle.getNumPlayers()
                              const winnerEndingBalance = await accounts[2].getBalance()

                              assert.equal(numPlayers.toString(), "0")
                              assert.equal(raffleState.toString(), "0")
                              assert(endingTimeStamp > startingTimeStamp)

                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(
                                      raffleEntranceFee.mul(additionalEntrants).add(raffleEntranceFee).toString()
                                  )
                              )
                          } catch (e) {
                              reject(e)
                          }
                      })

                      // this ordering of the code can only work for our local testing, since we can guarantee when stuff happens.
                      // on staging tests, when we don't know, we have to do it a bit different
                      const tx = await rossRaffle.performUpkeep([])
                      const txReceipt = await tx.wait(1)
                      const winnerStartingBalance = await accounts[2].getBalance() // found out which account by running the lottery

                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          rossRaffle.address
                      )
                  })
              })
          })
      })
