export interface Candle {
  /** Open time (ms epoch). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderbookLevel {
  price: number;
  quantity: number;
}

export interface Orderbook {
  bids: OrderbookLevel[]; // descending price
  asks: OrderbookLevel[]; // ascending price
  spread: number;
  midPrice: number;
}

export interface MarketSnapshot {
  symbol: string;
  markPrice: number | null;
  indexPrice: number | null;
  lastPrice: number | null;
  change24hPct: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  openInterest: number | null;
  fundingRate: number | null;
  nextFundingTime: number | null;
}
