// 本物のアプリならデータベースや外部 API。ここでは学習用の固定データです。
// ツールの output は JSON にできる値である必要があるので、interface ではなく type で定義します
export type Order = {
  orderId: string;
  item: string;
  status: '準備中' | '発送済み' | '配達完了';
  eta: string;
};

const ORDERS: Order[] = [
  { orderId: 'A-1001', item: 'ワイヤレスイヤホン', status: '発送済み', eta: '2026-10-16' },
  { orderId: 'A-1002', item: '電気ケトル', status: '準備中', eta: '2026-10-20' },
  { orderId: 'B-2001', item: '文庫本セット', status: '配達完了', eta: '2026-10-10' },
];

export const orders = {
  async get(orderId: string): Promise<Order | undefined> {
    return ORDERS.find((order) => order.orderId === orderId.toUpperCase());
  },
};
