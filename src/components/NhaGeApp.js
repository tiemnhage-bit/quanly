'use client';

import { useEffect, useMemo, useState } from 'react';
import { initialProducts, initialOrders } from '@/lib/mockData';

const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Number(n || 0)) + 'đ';
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function NhaGeApp() {
  const [screen, setScreen] = useState('home');
  const [orderTab, setOrderTab] = useState('new');
  const [orders, setOrders] = useState(initialOrders);
  const [products, setProducts] = useState(initialProducts);
  const [cart, setCart] = useState([]);
  const [payment, setPayment] = useState('Tiền mặt');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [foodForm, setFoodForm] = useState({ date: todayISO(), app: 'GrabFood', totalQty: '', total: '', note: '' });

  useEffect(() => {
    const savedOrders = localStorage.getItem('nha-ge-orders-v03');
    const savedProducts = localStorage.getItem('nha-ge-products-v03');
    if (savedOrders) setOrders(JSON.parse(savedOrders));
    if (savedProducts) setProducts(JSON.parse(savedProducts));
  }, []);

  useEffect(() => { localStorage.setItem('nha-ge-orders-v03', JSON.stringify(orders)); }, [orders]);
  useEffect(() => { localStorage.setItem('nha-ge-products-v03', JSON.stringify(products)); }, [products]);

  const dayOrders = useMemo(() => orders.filter(o => o.date === todayISO() && o.status !== 'Đã hủy'), [orders]);
  const todayRevenue = dayOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const todayQty = dayOrders.reduce((s, o) => s + Number(o.totalQty || 0), 0);
  const cashToday = dayOrders.filter(o => o.payment === 'Tiền mặt').reduce((s,o)=>s+Number(o.total||0),0);
  const bankToday = dayOrders.filter(o => o.payment === 'Chuyển khoản').reduce((s,o)=>s+Number(o.total||0),0);
  const knownCostToday = dayOrders.reduce((sum,o)=>sum+(o.items||[]).reduce((s,i)=>s+Number(i.cost||0)*Number(i.qty||0),0),0);

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
      id: `DH-${Date.now()}`, date: todayISO(),
      time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      source: 'Tại quán', payment, status: 'Hoàn tất',
      items: cart.map(x => ({ productId:x.id, name:x.name, qty:x.qty, price:x.price, cost:x.cost || 0 })),
      totalQty, total, note: ''
    };
    setOrders(prev => [order, ...prev]);
    setCart([]);
    setOrderTab('list');
  }

  function saveFoodOrder(e) {
    e.preventDefault();
    if (!foodForm.totalQty || !foodForm.total) return alert('Vui lòng nhập tổng số ly và doanh thu thực nhận.');
    const order = {
      id: `APP-${Date.now()}`, date: foodForm.date,
      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      source: foodForm.app, payment: 'App Food', status: 'Hoàn tất', items: [],
      totalQty: Number(foodForm.totalQty), total: Number(foodForm.total), note: foodForm.note || 'Nhập tổng cuối ngày'
    };
    setOrders(prev => [order, ...prev]);
    setFoodForm({ date: todayISO(), app: 'GrabFood', totalQty: '', total: '', note: '' });
    setScreen('order'); setOrderTab('list');
  }

  function cancelOrder(id) { setOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'Đã hủy' } : o)); setSelectedOrder(null); }
  function saveOrderEdit(updated) { setOrders(prev => prev.map(o => o.id === updated.id ? updated : o)); setSelectedOrder(null); }

  return <div className="app-shell">
    <header className="topbar"><div><div className="brand">TIỆM NHÀ GÉ</div><div className="date">Quản lý quán · Bản 0.3</div></div><button className="icon-btn" onClick={() => setScreen('more')}>⋯</button></header>
    <main>
      {screen === 'home' && <Home todayRevenue={todayRevenue} dayOrders={dayOrders} todayQty={todayQty} cashToday={cashToday} bankToday={bankToday} knownCostToday={knownCostToday} go={setScreen} openOrders={() => {setScreen('order');setOrderTab('list')}} />}
      {screen === 'order' && <OrdersScreen products={products.filter(p=>p.active!==false)} tab={orderTab} setTab={setOrderTab} cart={cart} addProduct={addProduct} changeQty={changeQty} payment={payment} setPayment={setPayment} completeOrder={completeOrder} orders={orders} openOrder={setSelectedOrder} goFood={() => setScreen('foodapp')} />}
      {screen === 'foodapp' && <FoodAppForm form={foodForm} setForm={setFoodForm} onSubmit={saveFoodOrder} back={() => {setScreen('order');setOrderTab('list')}} />}
      {screen === 'products' && <ProductManager products={products} setProducts={setProducts} back={()=>setScreen('more')} />}
      {screen === 'stock' && <Stock />}
      {screen === 'cash' && <Cash />}
      {screen === 'reports' && <Reports orders={orders} products={products} />}
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
  </div>;
}

function Nav({active,icon,label,onClick}) { return <button className={'nav-item '+(active?'active':'')} onClick={onClick}><span>{icon}</span><small>{label}</small></button> }

function Home({todayRevenue,dayOrders,todayQty,cashToday,bankToday,knownCostToday,go,openOrders}) {
  return <section className="screen">
    <div className="card hero"><div className="muted">DOANH THU HÔM NAY</div><div className="big-number">{fmt(todayRevenue)}</div><div className="stats-row"><div><strong>{dayOrders.length}</strong><span>đơn</span></div><div><strong>{todayQty}</strong><span>ly / sản phẩm</span></div></div></div>
    <div className="grid-2"><div className="card"><div className="muted">TIỀN MẶT</div><div className="money">{fmt(cashToday)}</div></div><div className="card"><div className="muted">CHUYỂN KHOẢN</div><div className="money">{fmt(bankToday)}</div></div></div>
    <div className="card"><div className="section-title">Lợi nhuận tạm tính</div><div className="profit">{fmt(Math.max(todayRevenue-knownCostToday,0))}</div><div className="summary-line"><span>Doanh thu</span><strong>{fmt(todayRevenue)}</strong></div><div className="summary-line"><span>Giá vốn đã biết</span><strong>-{fmt(knownCostToday)}</strong></div><p className="hint">Đơn App Food hiện chưa tách món nên chưa tính được giá vốn tự động.</p></div>
    <div className="quick-actions"><button onClick={openOrders}>Danh sách đơn</button><button onClick={()=>go('foodapp')}>Nhập đơn App Food</button><button onClick={()=>go('products')}>Món & giá vốn</button></div>
  </section>
}

function OrdersScreen({products,tab,setTab,cart,addProduct,changeQty,payment,setPayment,completeOrder,orders,openOrder,goFood}) {
  const [query,setQuery] = useState(''); const [source,setSource] = useState('Tất cả'); const [category,setCategory] = useState('Tất cả');
  const categories = ['Tất cả', ...Array.from(new Set(products.map(p=>p.category).filter(Boolean)))];
  const shownProducts = products.filter(p=>category==='Tất cả'||p.category===category).filter(p=>p.name.toLowerCase().includes(query.toLowerCase()));
  const filteredOrders = orders.filter(o => (source==='Tất cả'||o.source===source) && (o.id.toLowerCase().includes(query.toLowerCase())||o.source.toLowerCase().includes(query.toLowerCase())));
  const total = cart.reduce((s,x)=>s+x.price*x.qty,0);
  return <section className="screen">
    <div className="segmented"><button className={tab==='new'?'active':''} onClick={()=>setTab('new')}>Tạo đơn</button><button className={tab==='list'?'active':''} onClick={()=>setTab('list')}>Danh sách đơn</button></div>
    {tab==='new' ? <>
      <div className="search-row"><input placeholder="Tìm món..." value={query} onChange={e=>setQuery(e.target.value)} /></div>
      <div className="chips">{categories.map(c=><button key={c} className={'chip '+(category===c?'active':'')} onClick={()=>setCategory(c)}>{c}</button>)}</div>
      <div className="products">{shownProducts.map(p=><button className="product" key={p.id} onClick={()=>addProduct(p)}><span>{p.name}</span><strong>{fmt(p.price)}</strong></button>)}</div>
      <div className="card order-card"><div className="section-title">Đơn hiện tại</div>{!cart.length?<div className="empty">Chưa có món</div>:cart.map(x=><div className="cart-row" key={x.id}><div><strong>{x.name}</strong><small>{fmt(x.price)}</small></div><div className="qty"><button onClick={()=>changeQty(x.id,-1)}>−</button><span>{x.qty}</span><button onClick={()=>changeQty(x.id,1)}>+</button></div></div>)}<div className="summary-line total"><span>Tổng</span><strong>{fmt(total)}</strong></div><div className="payment-grid">{['Tiền mặt','Chuyển khoản'].map(x=><button key={x} className={'pay '+(payment===x?'active':'')} onClick={()=>setPayment(x)}>{x}</button>)}</div><button className="primary full" onClick={completeOrder}>Hoàn tất đơn</button></div>
    </> : <>
      <div className="list-tools"><input placeholder="Tìm mã đơn / nguồn bán" value={query} onChange={e=>setQuery(e.target.value)} /><select value={source} onChange={e=>setSource(e.target.value)}><option>Tất cả</option><option>Tại quán</option><option>GrabFood</option><option>ShopeeFood</option></select></div>
      <button className="primary full" onClick={goFood}>+ Nhập đơn từ App Food</button>
      <div className="orders-list">{filteredOrders.map(o=><button className="order-row" key={o.id} onClick={()=>openOrder(o)}><div><strong>{o.source}</strong><small>{o.date} · {o.time} · {o.totalQty} ly / sản phẩm</small><span className={'status '+(o.status==='Đã hủy'?'cancel':'')}>{o.status}</span></div><div className="order-money"><strong>{fmt(o.total)}</strong><small>{o.payment}</small><span>›</span></div></button>)}</div>
    </>}
  </section>
}

function ProductManager({products,setProducts,back}) {
  const empty = {id:null,name:'',category:'',price:'',cost:'',active:true};
  const [form,setForm] = useState(empty); const [editing,setEditing] = useState(false);
  function submit(e){ e.preventDefault(); if(!form.name||!form.price) return alert('Vui lòng nhập tên món và giá bán.');
    const item={...form,id:form.id||`p-${Date.now()}`,price:Number(form.price),cost:Number(form.cost||0),category:form.category||'Khác'};
    setProducts(prev=>editing?prev.map(p=>p.id===item.id?item:p):[...prev,item]); setForm(empty); setEditing(false);
  }
  function edit(p){setForm({...p});setEditing(true);window.scrollTo({top:0,behavior:'smooth'});}
  function toggle(id){setProducts(prev=>prev.map(p=>p.id===id?{...p,active:p.active===false?true:false}:p));}
  return <section className="screen"><button className="back" onClick={back}>← Quay lại</button><h2>Món & giá vốn</h2><p className="hint">Bản đầu chỉ cần nhập giá vốn trực tiếp. Khi muốn quản lý kho tự động, mình sẽ thêm công thức nguyên liệu sau.</p>
    <form className="form-card" onSubmit={submit}><label>Tên món<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ví dụ: Trà Ổi" /></label><label>Danh mục<input value={form.category} onChange={e=>setForm({...form,category:e.target.value})} placeholder="Ví dụ: Trà trái cây" /></label><div className="form-grid-2"><label>Giá bán<input type="number" value={form.price} onChange={e=>setForm({...form,price:e.target.value})} /></label><label>Giá vốn<input type="number" value={form.cost} onChange={e=>setForm({...form,cost:e.target.value})} placeholder="Có thể nhập sau" /></label></div><button className="primary full">{editing?'Lưu thay đổi':'+ Thêm món'}</button>{editing&&<button type="button" className="secondary full" onClick={()=>{setForm(empty);setEditing(false)}}>Bỏ chỉnh sửa</button>}</form>
    <div className="product-admin-list">{products.map(p=><div className="admin-row" key={p.id}><div><strong>{p.name}</strong><small>{p.category} · Bán {fmt(p.price)} · Vốn {fmt(p.cost)}</small><span className={p.active===false?'status cancel':'status'}>{p.active===false?'Đang ẩn':'Đang bán'}</span></div><div><button onClick={()=>edit(p)}>Sửa</button><button onClick={()=>toggle(p.id)}>{p.active===false?'Hiện':'Ẩn'}</button></div></div>)}</div>
  </section>
}

function FoodAppForm({form,setForm,onSubmit,back}) { return <section className="screen"><button className="back" onClick={back}>← Quay lại</button><h2>Nhập đơn từ App Food</h2><p className="hint">Nhập tổng cả ngày như một đơn. Có thể chọn ngày cũ để nhập bù.</p><form className="form-card" onSubmit={onSubmit}><label>Ngày bán<input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label><label>Ứng dụng<select value={form.app} onChange={e=>setForm({...form,app:e.target.value})}><option>GrabFood</option><option>ShopeeFood</option><option>Khác</option></select></label><label>Tổng số ly đã bán<input type="number" value={form.totalQty} onChange={e=>setForm({...form,totalQty:e.target.value})} placeholder="Ví dụ: 24" /></label><label>Doanh thu thực nhận<input type="number" value={form.total} onChange={e=>setForm({...form,total:e.target.value})} placeholder="Sau khi đã trừ phí sàn / quảng cáo" /></label><label>Ghi chú<textarea value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="Có thể bỏ trống" /></label><button className="primary full">Lưu đơn</button></form></section> }

function OrderDrawer({order,onClose,onCancel,onSave}) { const [draft,setDraft]=useState({...order}); return <div className="overlay" onClick={onClose}><aside className="drawer" onClick={e=>e.stopPropagation()}><div className="drawer-head"><div><small>MÃ ĐƠN</small><strong>{order.id}</strong></div><button onClick={onClose}>×</button></div><div className="detail-grid"><div><small>Ngày bán</small><strong>{draft.date}</strong></div><div><small>Nguồn</small><strong>{draft.source}</strong></div><label><small>Số ly / sản phẩm</small><input type="number" value={draft.totalQty} onChange={e=>setDraft({...draft,totalQty:Number(e.target.value)})}/></label><label><small>Tổng tiền</small><input type="number" value={draft.total} onChange={e=>setDraft({...draft,total:Number(e.target.value)})}/></label></div>{draft.items?.length>0&&<div className="card flat"><div className="section-title">Chi tiết món</div>{draft.items.map((x,i)=><div className="summary-line" key={i}><span>{x.name} × {x.qty}</span><strong>{fmt(x.price*x.qty)}</strong></div>)}</div>}<label className="drawer-note"><small>Ghi chú</small><textarea value={draft.note||''} onChange={e=>setDraft({...draft,note:e.target.value})}/></label><button className="primary full" onClick={()=>onSave(draft)}>Lưu chỉnh sửa</button>{order.status!=='Đã hủy'&&<button className="danger full" onClick={()=>onCancel(order.id)}>Hủy đơn</button>}</aside></div> }

function Stock(){return <section className="screen"><div className="screen-head"><div><h2>Kho</h2><p>Một chi nhánh dùng kho chung</p></div><button className="primary small">+ Phiếu nhập hàng</button></div><div className="card stock-list">{[['Ly 500ml','125 cái'],['Ly 1L','46 cái'],['Matcha','850 g'],['Ổi','3,2 kg']].map(([n,v])=><div className="stock-row" key={n}><strong>{n}</strong><span>{v}</span></div>)}</div><button className="secondary full">Kiểm kê kho</button></section>}
function Cash(){return <section className="screen"><h2>Thu chi</h2><div className="grid-2"><div className="card"><div className="muted">TIỀN VÀO</div><div className="money">40.000.000đ</div></div><div className="card"><div className="muted">TIỀN RA</div><div className="money">35.000.000đ</div></div></div><div className="card"><div className="section-title">Danh mục chi</div><div className="tag-list"><span>Mua nguyên liệu</span><span>Nhân viên</span><span>Mặt bằng</span><span>Điện nước</span><span>Quảng cáo</span><span>Khác</span></div><p className="hint">Có danh mục mặc định và chủ quán có thể tự thêm.</p></div></section>}
function Reports({orders}){const valid=orders.filter(o=>o.status!=='Đã hủy'); const revenue=valid.reduce((s,o)=>s+Number(o.total||0),0); return <section className="screen"><h2>Báo cáo</h2><div className="card"><div className="muted">TỔNG DOANH THU ĐANG GHI NHẬN</div><div className="big-number">{fmt(revenue)}</div></div><div className="report-menu"><button>Kết quả kinh doanh <span>›</span></button><button>Sản phẩm bán ra <span>›</span></button><button>Nguồn bán <span>›</span></button><button>Chênh lệch kho <span>›</span></button></div></section>}
function More({go}){return <section className="screen"><h2>Thêm</h2><div className="report-menu"><button onClick={()=>go('foodapp')}>Nhập đơn từ App Food <span>›</span></button><button onClick={()=>go('products')}>Món & giá vốn <span>›</span></button><button>Nguyên liệu <span>›</span></button><button>Cài đặt danh mục chi <span>›</span></button></div></section>}
