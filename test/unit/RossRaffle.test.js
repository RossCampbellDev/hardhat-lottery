const { assert, expect } = require("chai")
const { network, getNamedAccounts, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("RossRaffle", async function () {
          let rossRaffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer
          const chainId = network.config.chainId

          beforeEach(async function () {
              //const { deployer } = await getNamedAccounts()
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"]) //deploy everything (see the module exported tags!)
              rossRaffle = await ethers.getContract("RossRaffle", deployer) //connect it with our deployer
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              raffleEntranceFee = await rossRaffle.getEntranceFee()
          })

          describe("constructor", async function () {
              it("Initialises the raffle contract properly", async function () {
                  //normally 1 assert per 'it' is good practice
                  const raffleState = await rossRaffle.getRaffleState()
                  const interval = await rossRaffle.getInterval()
                  assert.equal(raffleState.toString(), "0") // 0 is open in the contract remember
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"]) // should match what's in our helper config
              })
          })

          describe("enterRaffle", async function () {
              it("Reverts when you don't pay enough to enter", async function () {
                  await expect(rossRaffle.enterRaffle()).to.be.revertedWith("RossRaffle__NotEnoughETHEntered") // our own error!
              })
              it("Records ppl when they enter", async function () {
                  await rossRaffle.enterRaffle({ value: raffleEntranceFee })
                  const playerFromContract = await rossRaffle.getPlayer(0) // check we're the deployer
                  assert.equal(playerFromContract, deployer)
              })
          })
      })
