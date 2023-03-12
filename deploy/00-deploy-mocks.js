const { network } = require("hardhat")
const { developmentChains } = require("../helper-hardhat-config")
const { ethers } = require("hardhat")

const BASE_FEE = ethers.utils.parseEther("0.25") // the base fee argument for the VRF coord constructor
const GAS_PRICE_LINK = 1e9 // calcualted val based on the gas price per LINK.  relates to the price of the chain.  "link per gas"

module.exports = async function ({ getNamedAccounts, deployments }) {
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()
    const args = [BASE_FEE, GAS_PRICE_LINK]

    const chainId = network.config.chainId // use hardhat to get it for us

    if (developmentChains.includes(network.name)) {
        log("Local network testing, deploying mocks...")
        //deploy the mock!
        await deploy("VRFCoordinatorV2Mock", {
            from: deployer,
            log: true,
            args: args,
        })
        log("Mocks deployed!")
    }
}

module.exports.tags = ["all", "mocks"]
