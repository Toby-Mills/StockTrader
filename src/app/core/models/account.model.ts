export interface Account {
  id: string;
  ownerUid: string;
  name: string;
  platform?: string;
  accountNumber?: string;
  currency: string;  // e.g. 'GBP', 'USD'
  broker?: string;
  description?: string;
  createdAt: Date;
}
