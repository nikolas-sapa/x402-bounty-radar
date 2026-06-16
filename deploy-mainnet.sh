#!/usr/bin/env bash
# Flip x402-bounty-radar to Base MAINNET (real USDC) with the keyless xpay facilitator.
# Usage:  ./deploy-mainnet.sh 0xYourMetaMaskAddress
# Zero KYC: xpay requires no API key; USDC settles on-chain straight to your wallet.
set -euo pipefail

WALLET="${1:-}"
if [[ ! "$WALLET" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "ERROR: pass a valid EVM address.  ./deploy-mainnet.sh 0x...(40 hex)" >&2
  exit 1
fi

PRICE="${X402_PRICE:-\$0.01}"
FAC="${X402_FACILITATOR_URL:-https://facilitator.xpay.sh}"

echo "Deploying MAINNET → payTo=$WALLET  facilitator=$FAC  price=$PRICE"
npx --yes wrangler@4 deploy \
  --var "PAY_TO_ADDRESS:$WALLET" \
  --var "X402_NETWORK:base" \
  --var "X402_PRICE:$PRICE" \
  --var "X402_FACILITATOR_URL:$FAC"

URL="https://x402-bounty-radar.nikolas-sapalidis.workers.dev"
echo "Verifying live payTo + network..."
sleep 4
curl -s "$URL/bounties" | python3 -c "import sys,json;a=json.load(sys.stdin)['accepts'][0];print('payTo:',a['payTo']);print('network:',a['network']);print('asset:',a['asset'])"
echo "Live: $URL/bounties"
