const BluebirdPromise = require("bluebird")
const axios = require("axios")
const chalk = require('chalk')
const fs = require("fs")
const path = require('path')
const constants = require('bip44-constants')
import { readFileSync } from "../../script/common/filesystem";
import { ethForkChains } from "../../script/common/blockchains";
import {
    toChecksum,
    getChainAssetLogoPath,
    isPathExistsSync,
    makeDirSync,
    getChainAssetPath,
    getChainDenylist,
    getChainAllowlist,
} from "../../script-old/helpers";
import { TickerType, mapTiker, PlatformType } from "../../script-old/models";

// Steps required to run this:
// 1. (Optional) CMC API key already setup, use yours if needed. Install script deps "npm i" if hasn't been run before.
// 2. Pull down tokens repo https://github.com/trustwallet/assets and point COIN_IMAGE_BASE_PATH and TOKEN_IMAGE_BASE_PATH to it.
// 3. Run: `npm run update`

const CMC_PRO_API_KEY = `df781835-e5f4-4448-8b0a-fe31402ab3af` // Free Basic Plan api key is enough to run script
const CMC_LATEST_BASE_URL = `https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/latest?`
const typeToken = TickerType.Token
const typeCoin = TickerType.Coin
const mappedChainsDenylistAssets = {} // {ethereum: {<0x...>: ""},}
const mappedChainsAllowlistAssets = {} // {ethereum: {<0x...>: ""},}

const custom: mapTiker[] = [
    {"coin": 60, "type": typeToken, "token_id": "0x6758B7d441a9739b98552B373703d8d3d14f9e62", "id": 2548}, // POA ERC20 on Foundation (POA20)
    {"coin": 195, "type": typeToken, "token_id": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "id": 825}, // Tether (TRC20)
    {"coin": 1023, "type": typeCoin, "id": 3945}, // Harmony ONE mainnet
    {"coin": 60, "type": typeToken, "token_id": "0x799a4202c12ca952cB311598a024C80eD371a41e", "id": 3945}, // Harmony ONE (ERC20)
    {"coin": 60, "type": typeToken, "token_id": "0xB8c77482e45F1F44dE1745F52C74426C631bDD52", "id": 1839}, // BNB (ERC20)
    {"coin": 304, "type": typeCoin, "id": 2777}, // IoTex coin
    {"coin": 1024, "type": typeToken, "token_id": "ong", "id": 3217}, // Ontology Gas (ONG)
    {"coin": 500, "type": typeToken, "token_id": "tfuel", "id": 3822}, // Theta Fuel (TFUEL)
    {"coin": 818, "type": typeToken, "token_id": "0x0000000000000000000000000000456E65726779", "id": 3012}, // VeThor Token (VTHO)
    {"coin": 459, "type": typeCoin, "id": 4846}, // KAVA coin
    {"coin": 60, "type": typeToken, "token_id": "0xFA1a856Cfa3409CFa145Fa4e20Eb270dF3EB21ab", "id": 2405}, // IOST (ERC20)
    {"coin": 60, "type": typeToken, "token_id": "0x2fe39f22EAC6d3c1C86DD9D143640EbB94609FCE", "id": 4929}, // JDC Coin (ERC20)
    {"coin": 60, "type": typeToken, "token_id": "0x5Cf04716BA20127F1E2297AdDCf4B5035000c9eb", "id": 2780}, // NKN (NKN)
    // {"coin": 714, "type": typeToken, "token_id": "CHZ-ECD", "id": 4066}, // Chiliz (BEP-2)
    {"coin": 60, "type": typeToken, "token_id": "0xdF1D6405df92d981a2fB3ce68F6A03baC6C0E41F", "id": 3816}, // VERA (VRA)
    {"coin": 60, "type": typeToken, "token_id": "0x467Bccd9d29f223BcE8043b84E8C8B282827790F", "id": 2394}, // Telcoin (TEL)
    // {"coin": 714, "type": typeToken, "token_id": "BUSD-BD1", "id": 4687}, // BUSD-BD1 (BEP2)
    {"coin": 60, "type": typeToken, "token_id": "0xBD87447F48ad729C5c4b8bcb503e1395F62e8B98", "id": 3408}, // Pool Usdc (plUsdc)
    {"coin": 60, "type": typeToken, "token_id": "0x49d716DFe60b37379010A75329ae09428f17118d", "id": 4943}, // Pool Dai (plDai)
    {"coin": 60, "type": typeToken, "token_id": "0x589891a198195061Cb8ad1a75357A3b7DbaDD7Bc", "id": 4036}, // Contentos (COS)
    {"coin": 60, "type": typeToken, "token_id": "0x30f271C9E86D2B7d00a6376Cd96A1cFBD5F0b9b3", "id": 5835}, // Decentr (DEC)
    // CMC returns multiple entries with 0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5 (2020-07-28), including them in the override to avoid duplicate
    // 5636 5742 5743 5744 5745 5746
    {"coin": 60, "type": typeToken, "token_id": "0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5", "id": 5636},
    {"coin": 60, "type": typeToken, "token_id": "0x41AB1b6fcbB2fA9DCEd81aCbdeC13Ea6315F2Bf2", "id": 2634},
    {"coin": 60, "type": typeToken, "token_id": "0xC011A72400E58ecD99Ee497CF89E3775d4bd732F", "id": 2586},
    // {"coin": 60, "type": typeToken, "token_id": "XXX", "id": XXX}, // XXX (XXX)
]

var allContracts: mapTiker[] = [] // Temp storage for mapped assets
let bnbOwnerToSymbol = {} // e.g: bnb1tawge8u97slduhhtumm03l4xl4c46dwv5m9yzk: WISH-2D5
let bnbOriginalSymbolToSymbol = {} // e.g: WISH: WISH-2D5

async function retrieveCmcData() {
    allContracts = []
    await Promise.all([initState(), setBinanceTokens()])
    const [totalCrypto, coins] = await Promise.all([getTotalActiveCryptocurrencies(), getTickers()])
    // setBIP44Constants()
    log(`Found ${totalCrypto} on CMC`, chalk.yellowBright)
    await BluebirdPromise.mapSeries(coins, processCoin)

    sortContracts()
    fs.writeFileSync(path.join(__dirname, 'cmc-data.json'), JSON.stringify(allContracts, null, 4))
    allContracts = []
}

export async function mergeCmcData() {
    try {
        allContracts = JSON.parse(readFileSync(path.join(__dirname, 'cmc-data.json')))
        addCustom()
        printContracts()
    } catch (error) {
        log(`Exception: ${error.message}`)
    }
}

export async function update() {
    try {
        await retrieveCmcData()
        await mergeCmcData()
    } catch (error) {
        log(`Exception: ${error.message}`)
    }
}

function buildCoinEntry(coin: any): any {
    const { id, symbol, name, platform } = coin
    const platformType: PlatformType = platform == null ? "" : platform.name
    log(`${symbol}:${platformType}`)
    switch (platformType) {
        case PlatformType.Ethereum:
            // log(`Ticker ${name}(${symbol}) is a token with address ${address} and CMC id ${id}`)
            if (platform.token_address) {
                try {
                    const checksum = toChecksum(platform.token_address)
                    if (!isAddressInDenyList("ethereum", checksum)) {
                        return {
                            coin: 60,
                            type: typeToken,
                            token_id: checksum,
                            id
                        }
                    }
                } catch (error) {
                    console.log(`Etheruem platform error`, error)
                    break
                }
            }
            break

        case PlatformType.Binance:
            if (symbol === "BNB") {
                break
            }
            const ownerAddress = platform.token_address.trim()
            log(`Symbol ${symbol}:${ownerAddress}:${id}`)
            if (ownerAddress && (ownerAddress in bnbOwnerToSymbol)) {
                return {
                    coin: 714,
                    type: typeToken,
                    token_id: bnbOwnerToSymbol[ownerAddress],
                    id
                }
            }

            if (symbol in bnbOriginalSymbolToSymbol) {
                return {
                    coin: 714,
                    type: typeToken,
                    token_id: bnbOriginalSymbolToSymbol[symbol].trim(),
                    id
                }
            }
            break

        case PlatformType.TRON:
            if (symbol === "TRX") {
                break
            }
            const tokenAddr = platform.token_address.trim()
            log(`tron: ${tokenAddr}`)
            if (tokenAddr.length > 0) {
                return {
                    coin: 195,
                    type: typeToken,
                    token_id: tokenAddr,
                    id
                }
            }
            break

        // case PlatformType.VeChain:
        //         if (symbol === "VET") {
        //             break
        //         }

        //         const addr = platform.token_address.trim()
        //         log(`vechain: ${tokenAddr}`)
        //         addToContractsList({
        //             coin: 0,
        //             type: typeCoin,
        //             token_id: addr,
        //             id
        //         })
        //         break

        default:
            const coinIndex = getSlip44Index(symbol, name)

            if (coinIndex >= 0) {
                log(`Ticker ${name}(${symbol}) is a coin with id ${coinIndex}`)
                return {
                    coin: coinIndex,
                    type: typeCoin,
                    id
                }
            }
            log(`Coin ${coinIndex} ${name}(${symbol}) not listed in slip44`)
            break
    }
    log(`Could not process entry ${symbol}:${name}:${platformType}`)
    return null
}

async function processCoin(coin) {
    const entry = buildCoinEntry(coin)
    if (!entry) {
        return
    }
    // check if it is in custom, in that case omit it
    if (entry.token_id && custom.find(elem => elem.coin == entry.coin && elem.token_id === entry.token_id)) {
        log(`Entry ${entry.token_id} is in custom, omitting`)
        return
    }
    addToContractsList(entry)
    log(`Added entry ${entry.token_id}`)
}

// Iniitalize state necessary for faster data looup during script run
async function initState () {
    await mapChainsAssetsLists()
}

async function mapChainsAssetsLists() {
    ethForkChains.forEach(chain => {
        Object.assign(mappedChainsAllowlistAssets, {[chain]: {}})
        Object.assign(mappedChainsDenylistAssets, {[chain]: {}})

        getChainAllowlist(chain).forEach(addr => {
            Object.assign(mappedChainsAllowlistAssets[chain], {[addr]: ""})
        })
        getChainDenylist(chain).forEach(addr => {
            Object.assign(mappedChainsDenylistAssets[chain], {[addr]: ""})
        })
    })
}

function addCustom() {
    custom.forEach(c => {
        addToContractsList(c)
    })
}

function addToContractsList(ticker: mapTiker) {
    allContracts.push(ticker)
}

function sortContracts() {
    const sortedById = allContracts.sort((a,b) => {
        if (a.id < b.id) return -1
        if (a.id > b.id) return 1

        if (a.hasOwnProperty("coin") && b.hasOwnProperty("coin")) {
            if (a.coin < b.coin) return -1
            if (a.coin > b.coin) return 1
        }

        if (a.token_id < b.token_id) return -1
        if (a.token_id > b.token_id) return 1
    })
    allContracts = sortedById
}


function printContracts() {
    sortContracts()
    const wstream = fs.createWriteStream(path.join(__dirname, 'mapping.json'))
    wstream.write(JSON.stringify(allContracts, null, 4))
}

function getSlip44Index(symbol: string, name: string): number {
    const coins = constants.filter(item =>  item[1] === symbol)
    if (coins.length == 0) return
    if (coins.length == 1) {
        const hex = '0x' + (coins[0][0]).toString(16)
        return parseInt(hex, 16) - ((1<<31)>>>0)
    }

    const coin = coins.filter(c => c[2] === name || c[2].includes(name))
    if (coin.length == 0) return
    const hex = '0x' + (coin[0][0]).toString(16)
    return parseInt(hex, 16) - ((1<<31)>>>0)
}

// id referes to cmc internal id
const getImageURL = (id: string | number): string => `https://s2.coinmarketcap.com/static/img/coins/128x128/${id}.png`

async function getImageIfMissing(chain: string, address: string, id: string) {
    try {
        const logoPath = getChainAssetLogoPath(chain, String(address))
        if (!isPathExistsSync(logoPath) && !isAddressInDenyList(chain, address)) {
            const imageStream = await fetchImage(getImageURL(id))

            if (imageStream) {
                const logoFolderPath = getChainAssetPath(chain, address)
                if(!isPathExistsSync(logoFolderPath)) {
                    makeDirSync(logoFolderPath)
                }
                imageStream.pipe(fs.createWriteStream(logoPath))
                log(`Image saved to: ${logoPath}`, chalk.green)
            }
        }

    } catch (error) {
        log(`Failed getImage to save token image ${error.message}`)
        exit(2)
    }
}


function isAddressInDenyList(chain: string, address: string): boolean {
    return mappedChainsDenylistAssets[chain].hasOwnProperty(address)
}

async function fetchImage(url: string) {
    try {
        return axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36'
            },
            responseType: "stream"
        }).then(res => res.data).catch(error => {
            console.log(`Error getRemoteResource ${error.message}`)
        })
    } catch (error) {
        log(`${error.message}`)
        exit(3)
        return false
    }
}

function exit(code?: number) {
    process.exit(code ?? 1)
}

function getTotalActiveCryptocurrencies() {
    return axios.get(`${CMC_LATEST_BASE_URL}CMC_PRO_API_KEY=${CMC_PRO_API_KEY}`).then((res) => res.data.data.active_cryptocurrencies).catch(e => {
        throw `Error getTotalActiveCryptocurrencies ${e.message}`
    })
}

async function setBinanceTokens () {
    return axios.get(`https://dex.binance.org/api/v1/tokens?limit=1000`).then(({ data }) => {
        bnbOwnerToSymbol = data.reduce((acm, token) => {
            log(`Token owner ${token.owner}:${token.symbol}`)
            acm[token.owner] = token.symbol
            return acm
        }, {})
        bnbOriginalSymbolToSymbol = data.reduce((acm, token) => {
            acm[token.original_symbol] = token.symbol
            return acm
        }, {})
    }).catch(error => {throw Error(`Error fetching Binance markets : ${error.message}`)})
}

function readBEP2() {
    // Fetch https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?CMC_PRO_API_KEY=YOUR_KEYc&limit=5000 and store full response
    // in file
    const validatorsList = JSON.parse(readFileSync("./pricing/coinmarketcap/cryptocurrency_map.json"))
    return validatorsList.data
}

async function getTickers() {
    const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?&limit=3500&CMC_PRO_API_KEY=${CMC_PRO_API_KEY}`
    return axios.get(url).then(res => res.data.data).catch(e => {throw `Error getTickers ${e.message}`})
}

function log(string, cb?) {
    if (cb) {
        console.log(cb(string))
    } else {
        console.log(string)
    }
    const saveToLogs = fs.createWriteStream(path.join(__dirname, '.syncTokensLog.txt'))
    saveToLogs.write(`${string}\n`)
}

// function setBIP44Constants() {
//     require('bip44-constants').forEach(row => {
//         bip44Constants[row[1]] = {
//             constant: row[0],
//             coinName: row[2]
//         }
//     })
// }
