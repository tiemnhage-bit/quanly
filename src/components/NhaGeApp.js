'use client';

import { useEffect, useMemo, useState } from 'react';
import { products, initialOrders } from '@/lib/mockData';

const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Number(n || 0)) + 'đ';
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function NhaGeApp() {
  const [screen, setScreen] = useState('home');
  const [orderTab, setOrderTab] = useState('new');
  const [orders, setOrders] = useState(initialOrders);
  const [cart, setCart] = useState([]);
  const [payment, setPayment] = useState('Tiền mặt');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [foodForm, setFoodForm] = useState({ date: todayISO(), app: 'GrabFood', totalQty: '', total: '', note: '' });

  useEffect(() => {
    const saved = localStorage.getItem('nha-ge-orders-v02');
    if (saved) setOrders(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem('nha-ge-orders-v02', JSON.stringify(orders));
  }, [orders]);

  const dayOrders = useMemo(() => orders.filter(o => o.date === todayISO() && o.status !== 'Đã hủy'), [orders]);
  const todayRevenue = dayOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const todayQty = dayOrders.reduce((s, o) => s + Number(o.totalQty || 0), 0);

  function addProduct(p) {
    setCart(prev => {
      const found = prev.find(x => x.id === p.id);
      if (found) return prev.map(x => x.id === p.id ? { ...x, qty: x.qty + 1 } : x);
      return [...prev, { ...p, qty: 1 }];
    });
  }

  function changeQty(id, delta) {
    setCart(prev => prev.map(x => x.id === id ? { ...x, qty: Math.max(0, x.qty + delta) } : x).filter(x => x.qty > 0));
  }

  function completeOrder() {
    if (!cart.length) return alert('Chưa có món trong đơn.');
    const total = cart.reduce((s, x) => s + x.price * x.qty, 0);
    const totalQty = cart.reduce((s, x) => s + x.qty, 0);
    const now = new Date();
    const order = {
      id: `DH-${Date.now()}`,
      date: todayISO(),
      time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      source: 'Tại quán',
      payment,
      status: 'Hoàn tất',
      items: cart.map(x => ({ name: x.name, qty: x.qty, price: x.price })),
      totalQty,
      total,
      note: ''
    };
    setOrders(prev => [order, ...prev]);
    setCart([]);
    setOrderTab('list');
  }

  function saveFoodOrder(e) {
    e.preventDefault();
    if (!foodForm.totalQty || !foodForm.total) return alert('Vui lòng nhập tổng số ly và doanh thu thực nhận.');
    const order = {
      id: `APP-${Date.now()}`,
      date: foodForm.date,
      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      source: foodForm.app,
      payment: 'App Food',
      status: 'Hoàn tất',
      items: [],
      totalQty: Number(foodForm.totalQty),
      total: Number(foodForm.total),
      note: foodForm.note || 'Nhập tổng cuối ngày'
    };
    setOrders(prev => [order, ...prev]);
    setFoodForm({ date: todayISO(), app: 'GrabFood', totalQty: '', total: '', note: '' });
    setScreen('order');
    setOrderTab('list');
  }

  function cancelOrder(id) {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'Đã hủy' } : o));
    setSelectedOrder(null);
  }

  function saveOrderEdit(updated) {
    setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
    setSelectedOrder(null);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div><div className="brand">TIỆM NHÀ GÉ</div><div className="date">Ưu tiên di động · MVP 0.2</div></div>
        <button className="icon-btn" onClick={() => setScreen('more')}>⋯</button>
      </header>

      <main>
        {screen === 'home' && <Home todayRevenue={todayRevenue} dayOrders={dayOrders} todayQty={todayQty} go={setScreen} openOrders={() => {setScreen('order');setOrderTab('list')}} />}
        {screen === 'order' && <OrdersScreen tab={orderTab} setTab={setOrderTab} cart={cart} addProduct={addProduct} changeQty={changeQty} payment={payment} setPayment={setPayment} completeOrder={completeOrder} orders={orders} openOrder={setSelectedOrder} goFood={() => setScreen('foodapp')} />}
        {screen === 'foodapp' && <FoodAppForm form={foodForm} setForm={setFoodForm} onSubmit={saveFoodOrder} back={() => {setScreen('order');setOrderTab('list')}} />}
        {screen === 'stock' && <Stock />}
        {screen === 'cash' && <Cash />}
        {screen === 'reports' && <Reports />}
        {screen === 'more' && <More go={setScreen} />}
      </main>

      <nav className="bottom-nav">
        <Nav active={screen==='home'} icon="⌂" label="Trang chủ" onClick={()=>setScreen('home')} />
        <Nav active={screen==='order'} icon="＋" label="Bán hàng" onClick={()=>setScreen('order')} />
        <Nav active={screen==='stock'} icon="▦" label="Kho" onClick={()=>setScreen('stock')} />
        <Nav active={screen==='cash'} icon="₫" label="Thu chi" onClick={()=>setScreen('cash')} />
        <Nav active={screen==='reports'} icon="▤" label="Báo cáo" onClick={()=>setScreen('reports')} />
      </nav>

      {selectedOrder && <OrderDrawer order={selectedOrder} onClose={()=>setSelectedOrder(null)} onCancel={cancelOrder} onSave={saveOrderEdit} />}
    </div>
  );
}

function Nav({active,icon,label,onClick}) { return <button className={'nav-item '+(active?'active':'')} onClick={onClick}><span>{icon}</span><small>{label}</small></button> }

function Home({todayRevenue,dayOrders,todayQty,go,openOrders}) {
  return <section className="screen">
    <div className="card hero"><div className="muted">DOANH THU HÔM NAY</div><div className="big-number">{fmt(todayRevenue)}</div><div className="stats-row"><div><strong>{dayOrders.length}</strong><span>đơn</span></div><div><strong>{todayQty}</strong><span>sản phẩm</span></div></div></div>
    <div className="grid-2"><div className="card"><div className="muted">TIỀN MẶT</div><div className="money">450.000đ</div></div><div className="card"><div className="muted">CHUYỂN KHOẢN</div><div className="money">800.000đ</div></div></div>
    <div className="card"><div className="section-title">Lợi nhuận ước tính hôm nay</div><div className="profit">+425.000đ</div><div className="summary-line"><span>Doanh thu</span><strong>{fmt(todayRevenue)}</strong></div><div className="summary-line"><span>Giá vốn</span><strong>-510.000đ</strong></div><div className="summary-line"><span>Chi phí phân bổ</span><strong>-315.000đ</strong></div></div>
    <div className="quick-actions"><button onClick={openOrders}>Danh sách đơn</button><button onClick={()=>go('foodapp')}>Nhập đơn từ App Food</button><button onClick={()=>go('stock')}>Nhập hàng</button></div>
  </section>
}

function OrdersScreen({tab,setTab,cart,addProduct,changeQty,payment,setPayment,completeOrder,orders,openOrder,goFood}) {
  const [query,setQuery] = useState('');
  const [source,setSource] = useState('Tất cả');
  const filtered = orders.filter(o => (source==='Tất cả'||o.source===source) && (o.id.toLowerCase().includes(query.toLowerCase())||o.source.toLowerCase().includes(query.toLowerCase())));
  const total = cart.reduce((s,x)=>s+x.price*x.qty,0);
  return <section className="screen">
    <div className="segmented"><button className={tab==='new'?'active':''} onClick={()=>setTab('new')}>Tạo đơn</button><button className={tab==='list'?'active':''} onClick={()=>setTab('list')}>Danh sách đơn</button></div>
    {tab==='new' ? <>
      <div className="products">{products.map(p=><button className="product" key={p.id} onClick={()=>addProduct(p)}><span>{p.name}</span><strong>{fmt(p.price)}</strong></button>)}</div>
      <div className="card order-card"><div className="section-title">Đơn hiện tại</div>{!cart.length?<div className="empty">Chưa có món</div>:cart.map(x=><div className="cart-row" key={x.id}><div><strong>{x.name}</strong><small>{fmt(x.price)}</small></div><div className="qty"><button onClick={()=>changeQty(x.id,-1)}>−</button><span>{x.qty}</span><button onClick={()=>changeQty(x.id,1)}>+</button></div></div>)}<div className="summary-line total"><span>Tổng</span><strong>{fmt(total)}</strong></div><div className="payment-grid">{['Tiền mặt','Chuyển khoản'].map(x=><button key={x} className={'pay '+(payment===x?'active':'')} onClick={()=>setPayment(x)}>{x}</button>)}</div><button className="primary full" onClick={completeOrder}>Hoàn tất đơn</button></div>
    </> : <>
      <div className="list-tools"><input placeholder="Tìm mã đơn / nguồn bán" value={query} onChange={e=>setQuery(e.target.value)} /><select value={source} onChange={e=>setSource(e.target.value)}><option>Tất cả</option><option>Tại quán</option><option>GrabFood</option><option>ShopeeFood</option></select></div>
      <button className="primary full" onClick={goFood}>+ Nhập đơn từ App Food</button>
      <div className="orders-list">{filtered.map(o=><button className="order-row" key={o.id} onClick={()=>openOrder(o)}><div><strong>{o.source}</strong><small>{o.date} · {o.time} · {o.totalQty} sản phẩm</small><span className={'status '+(o.status==='Đã hủy'?'cancel':'')}>{o.status}</span></div><div className="order-money"><strong>{fmt(o.total)}</strong><small>{o.payment}</small><span>›</span></div></button>)}</div>
    </>}
  </section>
}

function FoodAppForm({form,setForm,onSubmit,back}) {
  return <section className="screen"><button className="back" onClick={back}>← Quay lại</button><h2>Nhập đơn từ App Food</h2><p className="hint">Nhập tổng cả ngày như một đơn. Có thể chọn ngày cũ để nhập bù.</p><form className="form-card" onSubmit={onSubmit}><label>Ngày bán<input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label><label>Ứng dụng<select value={form.app} onChange={e=>setForm({...form,app:e.target.value})}><option>GrabFood</option><option>ShopeeFood</option><option>Khác</option></select></label><label>Tổng số ly đã bán<input type="number" value={form.totalQty} onChange={e=>setForm({...form,totalQty:e.target.value})} placeholder="Ví dụ: 24" /></label><label>Doanh thu thực nhận<input type="number" value={form.total} onChange={e=>setForm({...form,total:e.target.value})} placeholder="Sau khi đã trừ phí sàn / quảng cáo" /></label><label>Ghi chú<textarea value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="Có thể bỏ trống" /></label><button className="primary full">Lưu đơn</button></form></section>
}

function OrderDrawer({order,onClose,onCancel,onSave}) {
  const [draft,setDraft] = useState({...order});
  return <div className="overlay" onClick={onClose}><aside className="drawer" onClick={e=>e.stopPropagation()}><div className="drawer-head"><div><small>MÃ ĐƠN</small><strong>{order.id}</strong></div><button onClick={onClose}>×</button></div><div className="detail-grid"><div><small>Ngày bán</small><strong>{draft.date}</strong></div><div><small>Nguồn</small><strong>{draft.source}</strong></div><label><small>Số sản phẩm</small><input type="number" value={draft.totalQty} onChange={e=>setDraft({...draft,totalQty:Number(e.target.value)})}/></label><label><small>Tổng tiền</small><input type="number" value={draft.total} onChange={e=>setDraft({...draft,total:Number(e.target.value)})}/></label></div>{draft.items?.length>0&&<div className="card flat"><div className="section-title">Chi tiết món</div>{draft.items.map((x,i)=><div className="summary-line" key={i}><span>{x.name} × {x.qty}</span><strong>{fmt(x.price*x.qty)}</strong></div>)}</div>}<label className="drawer-note"><small>Ghi chú</small><textarea value={draft.note||''} onChange={e=>setDraft({...draft,note:e.target.value})}/></label><button className="primary full" onClick={()=>onSave(draft)}>Lưu chỉnh sửa</button>{order.status!=='Đã hủy'&&<button className="danger full" onClick={()=>onCancel(order.id)}>Hủy đơn</button>}<p className="hint">MVP hiện cho sửa số lượng tổng, tổng tiền và ghi chú. Khi nối kho thật, việc sửa/hủy sẽ tự điều chỉnh tồn kho tương ứng.</p></aside></div>
}

function Stock(){return <section className="screen"><div className="screen-head"><div><h2>Kho</h2><p>Một chi nhánh dùng kho chung</p></div><button className="primary small">+ Phiếu nhập hàng</button></div><div className="card stock-list">{[['Ly 500ml','125 cái'],['Ly 1L','46 cái'],['Matcha','850 g'],['Ổi','3,2 kg']].map(([n,v])=><div className="stock-row" key={n}><strong>{n}</strong><span>{v}</span></div>)}</div><button className="secondary full">Kiểm kê kho</button></section>}
function Cash(){return <section className="screen"><h2>Thu chi</h2><div className="grid-2"><div className="card"><div className="muted">TIỀN VÀO</div><div className="money">40.000.000đ</div></div><div className="card"><div className="muted">TIỀN RA</div><div className="money">35.000.000đ</div></div></div><div className="card"><div className="section-title">Danh mục chi</div><div className="tag-list"><span>Mua nguyên liệu</span><span>Nhân viên</span><span>Mặt bằng</span><span>Điện nước</span><span>Quảng cáo</span><span>Khác</span></div><p className="hint">Có danh mục mặc định và chủ quán có thể tự thêm.</p></div></section>}
function Reports(){return <section className="screen"><h2>Báo cáo</h2><div className="report-menu"><button>Kết quả kinh doanh <span>›</span></button><button>Sản phẩm bán ra <span>›</span></button><button>Nguồn bán <span>›</span></button><button>Chênh lệch kho <span>›</span></button></div></section>}
function More({go}){return <section className="screen"><h2>Thêm</h2><div className="report-menu"><button onClick={()=>go('foodapp')}>Nhập đơn từ App Food <span>›</span></button><button>Sản phẩm & giá vốn <span>›</span></button><button>Nguyên liệu <span>›</span></button><button>Cài đặt danh mục chi <span>›</span></button></div></section>}
