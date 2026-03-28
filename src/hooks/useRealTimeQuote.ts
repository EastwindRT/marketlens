import { useState, useEffect, useRef } from 'react';

const KEY = import.meta.env.VITE_FINNHUB_API_KEY || '';

interface TradeData {
  price: number;
  timestamp: number;
  volume: number;
}

export function useRealTimeQuote(symbol: string) {
  const [quote, setQuote] = useState<TradeData | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!KEY || !symbol) return;

    const ws = new WebSocket(`wss://ws.finnhub.io?token=${KEY}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', symbol }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'trade' && data.data?.length > 0) {
        const trade = data.data[0];
        setQuote({ price: trade.p, timestamp: trade.t, volume: trade.v });
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => {};

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'unsubscribe', symbol }));
      }
      ws.close();
    };
  }, [symbol]);

  return quote;
}
