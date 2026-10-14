// 学習用の「顧客管理システム」。本物なら外部 API やデータベースです。
export interface Customer {
  customerId: string;
  name: string;
  plan: 'Free' | 'Pro' | 'Enterprise';
}

const CUSTOMERS: Customer[] = [
  { customerId: 'C-42', name: '山田 花子', plan: 'Pro' },
  { customerId: 'C-77', name: '佐藤 太郎', plan: 'Free' },
];

export const crm = {
  async lookup(customerId: string): Promise<Customer | null> {
    await new Promise((resolve) => setTimeout(resolve, 200)); // 通信の待ち時間のつもり
    return CUSTOMERS.find((c) => c.customerId === customerId) ?? null;
  },
};
