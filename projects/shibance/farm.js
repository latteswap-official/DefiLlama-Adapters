import BigNumber from "bignumber.js";
import masterchefABI from "config/abi/masterchef.json";
import erc20 from "config/abi/erc20.json";
import { getAddress, getMasterChefAddress } from "utils/addressHelpers";
import { BIG_TEN, BIG_ZERO } from "utils/bigNumber";
import multicall from "utils/multicall";

import { Interface } from '@ethersproject/abi';
import { getWeb3NoAccount } from 'utils/web3';
import MultiCallAbi from 'config/abi/Multicall.json';
import { getMulticallAddress } from 'utils/addressHelpers';


const multicall = async (abi, calls) => {
    const web3 = getWeb3NoAccount();
    const multi = new web3.eth.Contract(MultiCallAbi, getMulticallAddress());
    const itf = new Interface(abi);
    const calldata = calls.map((call) => [call.address.toLowerCase(), itf.encodeFunctionData(call.name, call.params)]);
    const { returnData } = await multi.methods.aggregate(calldata).call();
    const res = returnData.map((call, i) => itf.decodeFunctionResult(calls[i].name, call));
    return res;
};

const fetchFarm = async (farm) => {
  const { pid, lpAddresses, token, quoteToken } = farm;
  const lpAddress = getAddress(lpAddresses);
  const farmFetch = async () => {
    var _a;
    const calls = [
      // Balance of token in the LP contract
      {
        address: getAddress(token.address),
        name: "balanceOf",
        params: [lpAddress],
      },
      // Balance of quote token on LP contract
      {
        address: getAddress(quoteToken.address),
        name: "balanceOf",
        params: [lpAddress],
      },
      // Balance of LP tokens in the master chef contract
      {
        address: lpAddress,
        name: "balanceOf",
        params: [getMasterChefAddress()],
      },
      // Total supply of LP tokens
      {
        address: lpAddress,
        name: "totalSupply",
      },
      // Token decimals
      {
        address: getAddress(token.address),
        name: "decimals",
      },
      // Quote token decimals
      {
        address: getAddress(quoteToken.address),
        name: "decimals",
      },
    ];
    const [
      tokenBalanceLP,
      quoteTokenBalanceLP,
      lpTokenBalanceMC,
      lpTotalSupply,
      tokenDecimals,
      quoteTokenDecimals,
    ] = await multicall(erc20, calls);
    // Ratio in % of LP tokens that are staked in the MC, vs the total number in circulation
    const lpTokenRatio = new BigNumber(lpTokenBalanceMC).div(
      new BigNumber(lpTotalSupply)
    );
    // Raw amount of token in the LP, including those not staked
    const tokenAmountTotal = new BigNumber(tokenBalanceLP).div(
      BIG_TEN.pow(tokenDecimals)
    );
    const quoteTokenAmountTotal = new BigNumber(quoteTokenBalanceLP).div(
      BIG_TEN.pow(quoteTokenDecimals)
    );
    // Amount of token in the LP that are staked in the MC (i.e amount of token * lp ratio)
    const tokenAmountMc = tokenAmountTotal.times(lpTokenRatio);
    const quoteTokenAmountMc = quoteTokenAmountTotal.times(lpTokenRatio);
    // Total staked in LP, in quote token value
    const lpTotalInQuoteToken = quoteTokenAmountMc.times(new BigNumber(2));
    // Only make masterchef calls if farm has pid
    const [info, totalAllocPoint] =
      pid || pid === 0
        ? await multicall(masterchefABI, [
            {
              address: getMasterChefAddress(),
              name: "poolInfo",
              params: [pid],
            },
            {
              address: getMasterChefAddress(),
              name: "totalAllocPoint",
            },
          ])
        : [null, null];
    const allocPoint = info
      ? new BigNumber(
          (_a = info.allocPoint) === null || _a === void 0 ? void 0 : _a._hex
        )
      : BIG_ZERO;
    const poolWeight = totalAllocPoint
      ? allocPoint.div(new BigNumber(totalAllocPoint))
      : BIG_ZERO;
    return {
      tokenAmountMc: tokenAmountMc.toJSON(),
      quoteTokenAmountMc: quoteTokenAmountMc.toJSON(),
      tokenAmountTotal: tokenAmountTotal.toJSON(),
      quoteTokenAmountTotal: quoteTokenAmountTotal.toJSON(),
      lpTotalSupply: new BigNumber(lpTotalSupply).toJSON(),
      lpTotalInQuoteToken: lpTotalInQuoteToken.toJSON(),
      tokenPriceVsQuote: quoteTokenAmountTotal.div(tokenAmountTotal).toJSON(),
      poolWeight: poolWeight.toJSON(),
      multiplier: `${allocPoint.div(100).toString()}X`,
    };
  };
  // In some browsers promise above gets stuck that causes fetchFarms to not proceed.
  const timeout = new Promise((resolve) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      resolve({});
    }, 5000);
  });
  return Promise.race([timeout, farmFetch()]);
};

