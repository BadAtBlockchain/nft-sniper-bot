import { ethers } from "ethers";
import fs from "fs";
import fetch from 'node-fetch';
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const marketplaceAbi = require("./abi/nftkeymarket.json");
const erc721Abi = require("./abi/ERC721.json");

const collections = [
  {
    name: "knights",
    address: "0x56eb68f994A4e2D8D6FAe6Ca4B5061B6f7FD92Cb",
    alias: "knightsandpeasants",
    floor: 0
  }
];

let lastKnownFloors = {};
const urlProvider = "https://rpc.gainzstation.one";

// set up multiple contracts to sniff on
const addresses = {
  recipient: '0xDb2f7F5acB774cB7f4d33B73303B089DB7b5a2b0', // me
  marketplace: '0x42813a05ec9c7e17aF2d1499F9B0a591B7619aBF'
};

//const provider = new ethers.providers.WebSocketProvider(wsProviderUrl);
const provider = new ethers.providers.JsonRpcProvider(urlProvider);
const account = new ethers.Wallet(
  '', // convert to process env => key elsewhere rn
  provider
);

let marketplace = new ethers.Contract(
  addresses.marketplace,
  marketplaceAbi,
  account
);

async function getFloorPrice(alias) {
  let req = await fetch("https://nftkey.app/graphql", {
    "headers": {
      "accept": "*/*",
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/json",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "sec-gpc": "1",
      "Referer": `https://nftkey.app/collections/${alias}/`,
      "Referrer-Policy": "strict-origin-when-cross-origin"
    },
    "body": `{\"operationName\":\"GetERC721Collection\",\"variables\":{\"alias\":\"${alias}\"},\"query\":\"query GetERC721Collection($alias: String!) {\\n  erc721CollectionByAlias(alias: $alias) {\\n    ...ERC721CollectionInfo\\n    __typename\\n  }\\n}\\n\\nfragment ERC721CollectionInfo on ERC721CollectionInfo {\\n  id\\n floor\\n  __typename\\n}\\n\"}`,
    "method": "POST"
  });
  let data = await req.json();
  return data["data"]["erc721CollectionByAlias"]["floor"];
}

// calculate the floor of our target collections
async function getCurrentFloorPrices() {
  // loop our watched collections
  let promises = [];
  for (let i = 0; i < collections.length; i++) {
    promises.push(getFloorPrice(collections[i].alias));
  }

  let responses = await Promise.all(promises);

  console.log("Current Floors for watched collections:")
  for (let i = 0; i < collections.length; i++) {
    let address = collections[i].address;
    let floor = responses[i];
    lastKnownFloors[address] = floor;

    console.log(`${getCollectionAliasFromAddress(address)} | ${lastKnownFloors[address]} ONE`);
  }
  console.log("");
}

function getCollectionAliasFromAddress(address) {
  let alias = "";

  for (let i = 0; i < collections.length; i++) {
    if (collections[i].address == address) {
      alias = collections[i].alias;
      break;
    }
  }

  return alias;
}

console.log(`%c ________________________________________
< mooooooooooooooooooooooooooooooooooooo >
 ----------------------------------------
        \\   ^__^
         \\  (oo)\\_______
            (__)\\       )\\/\\
                ||----w |
                ||     ||`, "font-family:monospace")
console.log("\n");

console.log(`Wallet: ${account.address.toString()}`);
// check my balance of ONE, and make sure we are okay to buy
let balance = await provider.getBalance(account.address);
let balanceInOne = ethers.utils.formatEther(balance);
console.log(`Balance: ${balanceInOne} ONE`);

await getCurrentFloorPrices();

marketplace.on('TokenListed', (erc721Address, tokenId, listing) => onTokenListed(erc721Address, tokenId, listing));

const onTokenListed = async (tokenAddress, tokenId, listing) => {
  // let tokenId = listing[0];
  let listingPrice = ethers.utils.parseUnits(listing[1].toString(), 'wei').div(ethers.utils.parseEther("1.0"));
  let listingSeller = listing[2];
  // let listingTimeStamp = listing[3];

  // are we the seller? ignore...
  if (listingSeller.toString() == account.address.toString()) return;

  let address = tokenAddress.toString();
  console.log("\n--- New Listing ---");
  console.log(`Time: ${new Date().getTime()}`)
  console.log(`ERC721: ${address}`);
  console.log(`Token Id: ${tokenId.toString()}`);
  console.log(`Price: ${listingPrice}`);
  console.log(`Seller: ${listingSeller.toString()}`);
  console.log("-----");

  // is this a token collection we are interested in?
  // check the floor of this collection
  let alias = getCollectionAliasFromAddress(address);
  if (alias !== "") {
    console.log(`Watched listing for: ${alias}`);
    console.log(`Last known floor: ${lastKnownFloors[address]}`);
    let tenPercentOfFloor = lastKnownFloors[address] * 0.9;
    
    // -10 below for gas
    if (listingPrice < (balanceInOne - 10) && listingPrice <= tenPercentOfFloor) {
      console.log("Target acquired...\n");
      console.log("(҂‾ ▵‾)︻デ═一 (˚▽˚’!)/\n")
      console.log(`${new Date().getTime()}`);

      // =====
      //  buy
      // =====
  
      const buyOptions = {
        value: ethers.utils.parseEther(listingPrice.toString()),
        gasPrice: 1e11, // 100 GWEI (fast)
        gasLimit: 1e6 // total of 0.1 ONE for gas, should mine pretty quick
      };

      const buyTx = await marketplace.buyToken(address, tokenId, buyOptions);
      console.log(`Trying to buy... ${buyTx.hash.toString()}`);
      await buyTx.wait();
      console.log("Buy complete!");
      console.log(`${new Date().getTime()}`);
      console.log("===============================================================\n");

      // =====
      // approve market to sell this nft
      // =====
      let erc721Contract = new ethers.Contract(
        address,
        erc721Abi,
        account
      );

      let alreadyApproved = await erc721Contract.isApprovedForAll(account.address, marketplace.address);
      if (!alreadyApproved) {
        const approveOptions = {
          gasPrice: 1e11, // 100 GWEI (fast)
          gasLimit: 1e6 // total of 0.1 ONE for gas, should mine pretty quick
        };

        const approveAllTx = await erc721Contract.setApprovalForAll(marketplace.address, true, approveOptions);
        console.log(`Approving marketplace for all... ${approveAllTx.hash.toString()}`);
        await approveAllTx.wait();
        console.log("Approved");
        console.log(`${new Date().getTime()}`);
      }

      // =====
      // relist immediately after for just under floor, do i write a contract for this and do all in one tx?
      // =====
      console.log("Relisting for just under floor :pepebusiness:");

      const listingOptions = {
        gasPrice: 1e11, // 100 GWEI (fast)
        gasLimit: 1e6 // total of 0.1 ONE for gas, should mine pretty quick
      };

      let floorMinus1 = lastKnownFloors[address] - 1;
      let thirtyDaysFromNow = Math.round(new Date().getTime() / 1000) + (60 * 60 * 24 * 30);
      const listingTx = await marketplace.listToken(address, tokenId, ethers.utils.parseEther(floorMinus1.toString()), thirtyDaysFromNow, listingOptions);
      console.log(`Relisting... ${listingTx.hash.toString()}`);
      await listingTx.wait();
      console.log(`Listed: https://nftkey.app/collections/${alias}/token-details/?tokenId=${tokenId}`);
      console.log(`${new Date().getTime()}`);

      // update our balance
      balance = await provider.getBalance(account.address);
      balanceInOne = ethers.utils.formatEther(balance);
      console.log(`New balance: ${balanceInOne.toString()}`);
    }
    
    // update our floor price now?
    let newFloor = await getFloorPrice(alias);
    if (newFloor != lastKnownFloors[address]) {
      lastKnownFloors[address] = newFloor;
      console.log(`Floor updated for ${alias}`);
      console.log(`${new Date().getTime()}`);
    }
  }
}