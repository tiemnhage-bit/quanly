export const products = [
  { id: 'p1', name: 'Cà phê sữa', category: 'Cà phê', price: 18000, cost: 7600 },
  { id: 'p2', name: 'Bạc xỉu', category: 'Cà phê', price: 22000, cost: 8659 },
  { id: 'p3', name: 'Trà Ổi', category: 'Trà', price: 22000, cost: 9919 },
  { id: 'p4', name: 'Matcha Latte', category: 'Matcha', price: 25000, cost: 9416 },
  { id: 'p5', name: 'Trà Chanh', category: 'Trà', price: 18000, cost: 10567 },
  { id: 'p6', name: 'Cà phê muối', category: 'Cà phê', price: 25000, cost: 10212 }
];

export const initialOrders = [
  {
    id: 'DH-240824-001',
    date: '2026-08-24',
    time: '08:12',
    source: 'Tại quán',
    payment: 'Chuyển khoản',
    status: 'Hoàn tất',
    items: [{ name: 'Cà phê sữa', qty: 2, price: 18000 }],
    totalQty: 2,
    total: 36000,
    note: ''
  },
  {
    id: 'APP-240823-GRAB',
    date: '2026-08-23',
    time: '22:05',
    source: 'GrabFood',
    payment: 'App Food',
    status: 'Hoàn tất',
    items: [],
    totalQty: 24,
    total: 550000,
    note: 'Nhập tổng cuối ngày'
  }
];
