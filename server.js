import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = 3000;

const FEES = {
  buy: 0.007,
  sell: 0.006
};

const BINANCE_URL =
  "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";

// ---------- FUNCIÓN PARA OBTENER PRECIO P2P ----------
async function getP2PPrice(fiat, tradeType) {
  const response = await axios.post(BINANCE_URL, {
    asset: "USDT",
    fiat,
    tradeType,
    page: 1,
    rows: 10,
    merchantCheck: false
  });

  const ads = response.data.data;

  if (!ads || ads.length === 0) {
    throw new Error("Sin anuncios disponibles");
  }

  // 🔥 Filtrar liquidez mínima 20 USDT
  const filtered = ads
    .filter(ad => Number(ad.adv.tradableQuantity) >= 20)
    .slice(0, 5);

  if (filtered.length === 0) {
    throw new Error("Sin liquidez suficiente");
  }

  // 🔥 Weighted average
  let totalVolume = 0;
  let weightedSum = 0;

  filtered.forEach(ad => {
    const price = Number(ad.adv.price);
    const volume = Number(ad.adv.tradableQuantity);

    totalVolume += volume;
    weightedSum += price * volume;
  });

  return weightedSum / totalVolume;
}

// ---------- MARGEN DINÁMICO ----------
function dynamicMargin(spread) {
  if (spread > 0.20) return 0.10;
  if (spread > 0.10) return 0.08;
  return 0.05;
}

// ---------- ENDPOINT PRINCIPAL ----------
app.post("/api/calc", async (req, res) => {
  try {
    const { amountCLP, dest } = req.body;
    const clp = Number(amountCLP);

    if (!clp || clp <= 0) {
      return res.status(400).json({ ok: false, error: "Monto inválido" });
    }

    // 1️⃣ Comprar USDT con CLP
    const buyPrice = await getP2PPrice("CLP", "BUY");

    // 2️⃣ Vender USDT al país destino
    const sellPrice = await getP2PPrice(dest, "SELL");

    // 3️⃣ Spread real
    const spread = (sellPrice - buyPrice) / buyPrice;

    const margin = dynamicMargin(spread);

    // 4️⃣ Cálculo USDT
    const usdtGross = clp / buyPrice;
    const usdtAfterBuyFee = usdtGross * (1 - FEES.buy);

    if (usdtAfterBuyFee < 10) {
      return res.json({
        ok: true,
        valid: false,
        reason: "MIN_USDT_10_REAL"
      });
    }

    const usdtAfterSellFee = usdtAfterBuyFee * (1 - FEES.sell);

    const usdtFinal = usdtAfterSellFee * (1 - margin);

    const destFinal = usdtFinal * sellPrice;

    const offeredRate = clp / destFinal;

    res.json({
      ok: true,
      valid: true,
      amountCLP: clp,
      amountDest: destFinal,
      offeredRate,
      debug: {
        buyPrice,
        sellPrice,
        spread,
        margin
      }
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ ok: false, error: "Error Binance P2P" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});