'use client';

import { useEffect, useMemo, useState } from 'react';
import { initialProducts } from '@/lib/mockData';
import { supabase, supabaseReady } from '@/lib/supabase';

const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Number(n || 0)) + 'đ';
const todayISO = () => new Date().toISOString().slice(0, 10);

const IMPORTED_INGREDIENTS = [{"id": "nl-ca-phe-hat", "name": "Cà Phê Hạt", "type": "Nguyên liệu", "unit": "g", "qty": 20000, "minQty": 100}, {"id": "nl-sua-dac", "name": "Sữa Đặc", "type": "Nguyên liệu", "unit": "ml", "qty": 6000, "minQty": 2000}, {"id": "nl-sua-tuoi-vinamil", "name": "Sữa Tươi Vinamil", "type": "Nguyên liệu", "unit": "ml", "qty": 0, "minQty": 20}, {"id": "nl-phindi-hanh-nhan", "name": "Phindi Hạnh Nhân", "type": "Nguyên liệu", "unit": "ml", "qty": 0, "minQty": 20}, {"id": "bb-ly-ca-phe", "name": "Ly Cà Phê", "type": "Bao bì", "unit": "cái", "qty": 1000, "minQty": 200}, {"id": "nl-rich-lun", "name": "Rích Lùn", "type": "Nguyên liệu", "unit": "ml", "qty": 0, "minQty": 0}, {"id": "bb-ly-lun-500", "name": "Ly Lùn 500ml", "type": "Bao bì", "unit": "cái", "qty": 0, "minQty": 0}];

const IMPORTED_RECIPES = {"Cà Phê Đen": [["Cà Phê Hạt", 20], ["Ly Cà Phê", 1]], "Cà Phê Sữa": [["Cà Phê Hạt", 20], ["Ly Cà Phê", 1], ["Sữa Đặc", 30]], "Bạc Xỉu": [["Cà Phê Hạt", 20], ["Ly Lùn 500ml", 1], ["Sữa Đặc", 20], ["Rích Lùn", 10]]};

const normName = (s='') => String(s).trim().toLocaleLowerCase('vi-VN');

function mergeImportedIngredients(current=[]) {
  const result = [...current];
  for (const incoming of IMPORTED_INGREDIENTS) {
    const idx = result.findIndex(x => normName(x.name) === normName(incoming.name));
    if (idx >= 0) {
      // Giữ tồn hiện tại nếu người dùng đã có dữ liệu; chỉ bổ sung trường còn thiếu.
      result[idx] = {
        ...incoming,
        ...result[idx],
        id: result[idx].id || incoming.id,
        type: result[idx].type || incoming.type,
        unit: result[idx].unit || incoming.unit,
        minQty: Number(result[idx].minQty ?? incoming.minQty ?? 0),
        qty: Number(result[idx].qty ?? incoming.qty ?? 0),
      };
    } else {
      result.push({...incoming});
    }
  }
  return result;
}

function applyImportedRecipes(currentProducts=[], mergedIngredients=[]) {
  const idByName = Object.fromEntries(mergedIngredients.map(x => [normName(x.name), x.id]));
  return currentProducts.map(product => {
    const raw = IMPORTED_RECIPES[product.name];
    if (!raw) return product;
    const recipe = raw.map(([ingredientName, qty]) => ({
      ingredientId: idByName[normName(ingredientName)],
      qty: Number(qty)
    })).filter(x => x.ingredientId);
    return {...product, recipe};
  });
}

export default function NhaGeApp() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataReady, setDataReady] = useState(false);
  const [syncState, setSyncState] = useState('idle');
  const [syncError, setSyncError] = useState('');
  const [screen, setScreen] = useState('home');
  const [orderTab, setOrderTab] = useState('new');
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState(initialProducts);
  const [ingredients, setIngredients] = useState([]);
  const [stockReceipts, setStockReceipts] = useState([]);
  const [stockCounts, setStockCounts] = useState([]);
  const [stockAdjustments, setStockAdjustments] = useState([]);
  const [cart, setCart] = useState([]);
  const [payment, setPayment] = useState('Tiền mặt');
  const [discount, setDiscount] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [foodForm, setFoodForm] = useState({ date: todayISO(), app: 'GrabFood', totalQty: '', total: '', note: '' });

  useEffect(() => {
    if (!supabaseReady || !supabase) { setAuthLoading(false); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) { setUser(data.session?.user || null); setAuthLoading(false); }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      if (!session?.user) { setDataReady(false); setOrders([]); setProducts(initialProducts); setIngredients([]); setStockReceipts([]); setStockCounts([]); setStockAdjustments([]); }
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!user || !supabase) return;
    let alive = true;
    setDataReady(false); setSyncState('saving'); setSyncError('');
    (async () => {
      const { data, error } = await supabase.from('app_states').select('products,orders,ingredients,stock_receipts,stock_counts,stock_adjustments').eq('user_id', user.id).maybeSingle();
      if (!alive) return;
      if (error) { setSyncState('error'); setSyncError(error.message); return; }
      if (data) {
        const baseIngredients = Array.isArray(data.ingredients) ? data.ingredients : [];
        const mergedIngredients = mergeImportedIngredients(baseIngredients);
        const baseProducts = Array.isArray(data.products) && data.products.length ? data.products : initialProducts;
        const mergedProducts = applyImportedRecipes(baseProducts, mergedIngredients);
        setProducts(mergedProducts);
        setOrders(Array.isArray(data.orders) ? data.orders : []);
        setIngredients(mergedIngredients);
        setStockReceipts(Array.isArray(data.stock_receipts) ? data.stock_receipts : []);
        setStockCounts(Array.isArray(data.stock_counts) ? data.stock_counts : []);
        setStockAdjustments(Array.isArray(data.stock_adjustments) ? data.stock_adjustments : []);
      } else {
        const firstIngredients = mergeImportedIngredients([]);
        const firstProducts = applyImportedRecipes(initialProducts, firstIngredients);
        const { error: createError } = await supabase.from('app_states').insert({ user_id:user.id, products:firstProducts, orders:[], ingredients:firstIngredients, stock_receipts:[], stock_counts:[], stock_adjustments:[] });
        if (createError) { setSyncState('error'); setSyncError(createError.message); return; }
        setProducts(firstProducts); setIngredients(firstIngredients); setOrders([]);
      }
      setDataReady(true); setSyncState('saved');
    })();
    return () => { alive = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!user || !supabase || !dataReady) return;
    setSyncState('saving');
    const timer = setTimeout(async () => {
      const { error } = await supabase.from('app_states').upsert({ user_id:user.id, products, orders, ingredients, stock_receipts:stockReceipts, stock_counts:stockCounts, stock_adjustments:stockAdjustments, updated_at:new Date().toISOString() });
      if (error) { setSyncState('error'); setSyncError(error.message); }
      else { setSyncState('saved'); setSyncError(''); }
    }, 500);
    return () => clearTimeout(timer);
  }, [products, orders, ingredients, stockReceipts, stockCounts, stockAdjustments, user?.id, dataReady]);

  const dayOrders = useMemo(() => orders.filter(o => o.date === todayISO() && o.status !== 'Đã hủy'), [orders]);
  const todayRevenue = dayOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const todayQty = dayOrders.reduce((s, o) => s + Number(o.totalQty || 0), 0);
  const cashToday = dayOrders.filter(o => o.payment === 'Tiền mặt').reduce((s,o)=>s+Number(o.total||0),0);
  const bankToday = dayOrders.filter(o => o.payment === 'Chuyển khoản').reduce((s,o)=>s+Number(o.total||0),0);
  const knownCostToday = dayOrders.reduce((sum,o)=>sum+(o.items||[]).reduce((s,i)=>s+Number(i.cost||0)*Number(i.qty||0),0),0);

  function addProduct(p) {
    setCart(prev => { const found = prev.find(x => x.id === p.id); if (found) return prev.map(x => x.id === p.id ? { ...x, qty: x.qty + 1 } : x); return [...prev, { ...p, qty: 1 }]; });
  }
  function changeQty(id, delta) { setCart(prev => prev.map(x => x.id === id ? { ...x, qty: Math.max(0, x.qty + delta) } : x).filter(x => x.qty > 0)); }
  function applyStockChange(items, direction, refId, reason='Bán hàng') {
    const movements = [];
    (items || []).forEach(item => {
      const product = products.find(p => p.id === item.productId);
      (product?.recipe || []).forEach(r => {
        const qty = Number(r.qty || 0) * Number(item.qty || 0) * direction;
        if (!qty) return;
        movements.push({ ingredientId:r.ingredientId, qty, productId:item.productId, productName:item.name });
      });
    });
    if (!movements.length) return [];
    setIngredients(prev => prev.map(ing => {
      const change = movements.filter(m=>m.ingredientId===ing.id).reduce((s,m)=>s+m.qty,0);
      return change ? {...ing, qty:Number(ing.qty||0)+change} : ing;
    }));
    const now = Date.now();
    setStockAdjustments(prev => [
      ...movements.map((m,i)=>({id:`TK-${now}-${i}`, date:todayISO(), ingredientId:m.ingredientId, qty:m.qty, reason, refId, note:m.productName||''})),
      ...prev
    ]);
    return movements;
  }

  function completeOrder() {
    if (!cart.length) return alert('Chưa có món trong đơn.');
    const subtotal = cart.reduce((s, x) => s + x.price * x.qty, 0);
    const discountValue = Math.max(0, Math.min(Number(discount || 0), subtotal));
    const total = subtotal - discountValue; const totalQty = cart.reduce((s, x) => s + x.qty, 0); const now = new Date();
    const items = cart.map(x=>({productId:x.id,name:x.name,qty:x.qty,price:x.price,cost:x.cost||0}));
    const id = `DH-${Date.now()}`;
    const stockMovements = applyStockChange(items, -1, id, 'Bán hàng');
    const order = { id, date:todayISO(), time:now.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'}), source:'Tại quán', payment, status:'Hoàn tất', items, stockMovements, totalQty, subtotal, discount:discountValue, total, note:'' };
    setOrders(prev => [order, ...prev]); setCart([]); setDiscount(''); setOrderTab('list');
  }
  function saveFoodOrder(e) {
    e.preventDefault(); if (!foodForm.totalQty || !foodForm.total) return alert('Vui lòng nhập tổng số ly và doanh thu thực nhận.');
    const order = { id:`APP-${Date.now()}`, date:foodForm.date, time:new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'}), source:foodForm.app, payment:'App Food', status:'Hoàn tất', items:[], totalQty:Number(foodForm.totalQty), subtotal:Number(foodForm.total), discount:0, total:Number(foodForm.total), note:foodForm.note||'Nhập tổng cuối ngày' };
    setOrders(prev => [order, ...prev]); setFoodForm({ date:todayISO(), app:'GrabFood', totalQty:'', total:'', note:'' }); setScreen('order'); setOrderTab('list');
  }
  function cancelOrder(id) {
    const order = orders.find(o=>o.id===id);
    if (order && order.status !== 'Đã hủy' && Array.isArray(order.stockMovements) && order.stockMovements.length) {
      setIngredients(prev => prev.map(ing => {
        const restore = order.stockMovements.filter(m=>m.ingredientId===ing.id).reduce((s,m)=>s-Math.min(Number(m.qty||0),0),0);
        return restore ? {...ing, qty:Number(ing.qty||0)+restore} : ing;
      }));
      const now=Date.now();
      setStockAdjustments(prev => [...order.stockMovements.map((m,i)=>({id:`HK-${now}-${i}`,date:todayISO(),ingredientId:m.ingredientId,qty:-Number(m.qty||0),reason:'Hoàn kho do hủy đơn',refId:id,note:''})),...prev]);
    }
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status:'Đã hủy' } : o)); setSelectedOrder(null);
  }
  function saveOrderEdit(updated) { setOrders(prev => prev.map(o => o.id === updated.id ? updated : o)); setSelectedOrder(null); }
  async function signOut(){ if (supabase) await supabase.auth.signOut(); }

  if (authLoading) return <LoadingScreen text="Đang kiểm tra tài khoản…" />;
  if (!supabaseReady) return <SetupScreen />;
  if (!user) return <AuthScreen />;
  if (!dataReady && syncState !== 'error') return <LoadingScreen text="Đang tải dữ liệu quán…" />;
  if (syncState === 'error' && !dataReady) return <SyncErrorScreen message={syncError} />;

  return <div className="app-shell">
    <header className="topbar"><div><div className="brand">TIỆM NHÀ GÉ</div><div className="date">Quản lý quán · Bản 0.9 · <span className={'sync '+syncState}>{syncState==='saving'?'Đang đồng bộ…':syncState==='error'?'Lỗi đồng bộ':'Đã đồng bộ'}</span></div></div><button className="icon-btn" onClick={() => setScreen('more')}>⋯</button></header>
    <main>
      {screen === 'home' && <Home todayRevenue={todayRevenue} dayOrders={dayOrders} todayQty={todayQty} cashToday={cashToday} bankToday={bankToday} knownCostToday={knownCostToday} go={setScreen} openOrders={() => {setScreen('order');setOrderTab('list')}} />}
      {screen === 'order' && <OrdersScreen products={products.filter(p=>p.active!==false)} tab={orderTab} setTab={setOrderTab} cart={cart} addProduct={addProduct} changeQty={changeQty} payment={payment} setPayment={setPayment} discount={discount} setDiscount={setDiscount} completeOrder={completeOrder} orders={orders} openOrder={setSelectedOrder} goFood={() => setScreen('foodapp')} />}
      {screen === 'foodapp' && <FoodAppForm form={foodForm} setForm={setFoodForm} onSubmit={saveFoodOrder} back={() => {setScreen('order');setOrderTab('list')}} />}
      {screen === 'products' && <ProductManager products={products} setProducts={setProducts} ingredients={ingredients} back={()=>setScreen('more')} />}
      {screen === 'stock' && <Stock ingredients={ingredients} setIngredients={setIngredients} receipts={stockReceipts} setReceipts={setStockReceipts} counts={stockCounts} setCounts={setStockCounts} adjustments={stockAdjustments} setAdjustments={setStockAdjustments} />}{screen === 'cash' && <Cash />}{screen === 'reports' && <Reports orders={orders} products={products} />}
      {screen === 'more' && <More go={setScreen} user={user} onSignOut={signOut} syncState={syncState} />}
    </main>
    <nav className="bottom-nav"><Nav active={screen==='home'} icon="⌂" label="Trang chủ" onClick={()=>setScreen('home')} /><Nav active={screen==='order'} icon="＋" label="Bán hàng" onClick={()=>setScreen('order')} /><Nav active={screen==='stock'} icon="▦" label="Kho" onClick={()=>setScreen('stock')} /><Nav active={screen==='cash'} icon="₫" label="Thu chi" onClick={()=>setScreen('cash')} /><Nav active={screen==='reports'} icon="▤" label="Báo cáo" onClick={()=>setScreen('reports')} /></nav>
    {selectedOrder && <OrderDrawer order={selectedOrder} onClose={()=>setSelectedOrder(null)} onCancel={cancelOrder} onSave={saveOrderEdit} />}
  </div>;
}

function AuthScreen(){
  const [username,setUsername]=useState('Admin'); const [password,setPassword]=useState('admin123'); const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  async function submit(e){ e.preventDefault(); setBusy(true); setMessage('');
    const normalized = username.trim().toLowerCase();
    const email = normalized === 'admin' ? 'admin@tiemnhage.local' : `${normalized}@tiemnhage.local`;
    const {error}=await supabase.auth.signInWithPassword({email,password});
    if(error) setMessage('Sai tên đăng nhập hoặc mật khẩu.');
    setBusy(false);
  }
  return <div className="auth-shell"><div className="auth-card"><div className="auth-logo">GÉ</div><h1>Quản lý quán</h1><p>Đăng nhập để dùng chung dữ liệu trên điện thoại và máy tính.</p><form className="auth-form" onSubmit={submit}><label>Tên đăng nhập<input required value={username} onChange={e=>setUsername(e.target.value)} autoCapitalize="none" /></label><label>Mật khẩu<input type="password" required minLength="6" value={password} onChange={e=>setPassword(e.target.value)} /></label>{message&&<div className="auth-message">{message}</div>}<button className="primary full" disabled={busy}>{busy?'Đang đăng nhập…':'Đăng nhập'}</button></form><p className="hint">Tài khoản chủ quán ban đầu: <b>Admin</b>. Sau khi kết nối dữ liệu, nên đổi mật khẩu mặc định.</p></div></div>
}
function LoadingScreen({text}){ return <div className="auth-shell"><div className="auth-card center"><div className="spinner"></div><strong>{text}</strong></div></div> }
function SetupScreen(){ return <div className="auth-shell"><div className="auth-card"><h1>Chưa kết nối dữ liệu</h1><p>Bản 0.9 cần thêm thông tin kết nối Supabase trên Vercel trước khi đăng nhập được.</p><div className="auth-message">Cần 2 biến: NEXT_PUBLIC_SUPABASE_URL và NEXT_PUBLIC_SUPABASE_ANON_KEY.</div></div></div> }
function SyncErrorScreen({message}){ return <div className="auth-shell"><div className="auth-card"><h1>Chưa tải được dữ liệu</h1><p>Hãy kiểm tra đã chạy file <b>supabase.sql</b> trong Supabase chưa.</p><div className="auth-message">{message}</div></div></div> }

function Nav({active,icon,label,onClick}) { return <button className={'nav-item '+(active?'active':'')} onClick={onClick}><span>{icon}</span><small>{label}</small></button> }

function Home({todayRevenue,dayOrders,todayQty,cashToday,bankToday,knownCostToday,go,openOrders}) {
  return <section className="screen">
    <div className="card hero"><div className="muted">DOANH THU HÔM NAY</div><div className="big-number">{fmt(todayRevenue)}</div><div className="stats-row"><div><strong>{dayOrders.length}</strong><span>đơn</span></div><div><strong>{todayQty}</strong><span>ly / sản phẩm</span></div></div></div>
    <div className="grid-2"><div className="card"><div className="muted">TIỀN MẶT</div><div className="money">{fmt(cashToday)}</div></div><div className="card"><div className="muted">CHUYỂN KHOẢN</div><div className="money">{fmt(bankToday)}</div></div></div>
    <div className="card"><div className="section-title">Lợi nhuận tạm tính</div><div className="profit">{fmt(Math.max(todayRevenue-knownCostToday,0))}</div><div className="summary-line"><span>Doanh thu</span><strong>{fmt(todayRevenue)}</strong></div><div className="summary-line"><span>Giá vốn đã biết</span><strong>-{fmt(knownCostToday)}</strong></div><p className="hint">Đơn App Food hiện chưa tách món nên chưa tính được giá vốn tự động.</p></div>
    <div className="quick-actions"><button onClick={openOrders}>Danh sách đơn</button><button onClick={()=>go('foodapp')}>Nhập đơn App Food</button><button onClick={()=>go('products')}>Món & giá vốn</button></div>
  </section>
}

function OrdersScreen({products,tab,setTab,cart,addProduct,changeQty,payment,setPayment,discount,setDiscount,completeOrder,orders,openOrder,goFood}) {
  const [query,setQuery] = useState(''); const [source,setSource] = useState('Tất cả'); const [category,setCategory] = useState('Tất cả');
  const categories = ['Tất cả', ...Array.from(new Set(products.map(p=>p.category).filter(Boolean)))];
  const shownProducts = products.filter(p=>category==='Tất cả'||p.category===category).filter(p=>p.name.toLowerCase().includes(query.toLowerCase()));
  const filteredOrders = orders.filter(o => (source==='Tất cả'||o.source===source) && (o.id.toLowerCase().includes(query.toLowerCase())||o.source.toLowerCase().includes(query.toLowerCase())));
  const subtotal = cart.reduce((s,x)=>s+x.price*x.qty,0);
  const discountValue = Math.max(0, Math.min(Number(discount || 0), subtotal));
  const total = subtotal - discountValue;
  return <section className="screen">
    <div className="segmented"><button className={tab==='new'?'active':''} onClick={()=>setTab('new')}>Tạo đơn</button><button className={tab==='list'?'active':''} onClick={()=>setTab('list')}>Danh sách đơn</button></div>
    {tab==='new' ? <>
      <div className="search-row"><input placeholder="Tìm món..." value={query} onChange={e=>setQuery(e.target.value)} /></div>
      <div className="chips">{categories.map(c=><button key={c} className={'chip '+(category===c?'active':'')} onClick={()=>setCategory(c)}>{c}</button>)}</div>
      <div className="products">{shownProducts.map(p=><button className="product" key={p.id} onClick={()=>addProduct(p)}><span>{p.name}</span><strong>{fmt(p.price)}</strong></button>)}</div>
      <div className="card order-card"><div className="section-title">Đơn hiện tại</div>{!cart.length?<div className="empty">Chưa có món</div>:cart.map(x=><div className="cart-row" key={x.id}><div><strong>{x.name}</strong><small>{fmt(x.price)}</small></div><div className="qty"><button onClick={()=>changeQty(x.id,-1)}>−</button><span>{x.qty}</span><button onClick={()=>changeQty(x.id,1)}>+</button></div></div>)}<div className="discount-box"><label>Giảm giá<input type="number" min="0" max={subtotal} value={discount} onChange={e=>setDiscount(e.target.value)} placeholder="0" /></label></div>{discountValue>0&&<div className="summary-line"><span>Tạm tính</span><strong>{fmt(subtotal)}</strong></div>}<div className="summary-line total"><span>Khách thanh toán</span><strong>{fmt(total)}</strong></div><div className="payment-grid">{['Tiền mặt','Chuyển khoản'].map(x=><button key={x} className={'pay '+(payment===x?'active':'')} onClick={()=>setPayment(x)}>{x}</button>)}</div><button className="primary full" onClick={completeOrder}>Hoàn tất đơn</button></div>
    </> : <>
      <div className="list-tools"><input placeholder="Tìm mã đơn / nguồn bán" value={query} onChange={e=>setQuery(e.target.value)} /><select value={source} onChange={e=>setSource(e.target.value)}><option>Tất cả</option><option>Tại quán</option><option>GrabFood</option><option>ShopeeFood</option></select></div>
      <button className="primary full" onClick={goFood}>+ Nhập đơn từ App Food</button>
      <div className="orders-list">{filteredOrders.map(o=><button className="order-row" key={o.id} onClick={()=>openOrder(o)}><div><strong>{o.source}</strong><small>{o.date} · {o.time} · {o.totalQty} ly / sản phẩm</small><span className={'status '+(o.status==='Đã hủy'?'cancel':'')}>{o.status}</span></div><div className="order-money"><strong>{fmt(o.total)}</strong><small>{o.payment}{Number(o.discount||0)>0?` · Giảm ${fmt(o.discount)}`:''}</small><span>›</span></div></button>)}</div>
    </>}
  </section>
}

function ProductManager({products,setProducts,ingredients,back}) {
  const empty = {id:null,name:'',category:'',price:'',cost:'',active:true,recipe:[]};
  const [form,setForm] = useState(empty); const [editing,setEditing] = useState(false); const [recipeProduct,setRecipeProduct]=useState(null);
  function submit(e){ e.preventDefault(); if(!form.name||!form.price) return alert('Vui lòng nhập tên món và giá bán.');
    const item={...form,id:form.id||`p-${Date.now()}`,price:Number(form.price),cost:Number(form.cost||0),category:form.category||'Khác',recipe:form.recipe||[]};
    setProducts(prev=>editing?prev.map(p=>p.id===item.id?item:p):[...prev,item]); setForm(empty); setEditing(false);
  }
  function edit(p){setForm({...p,recipe:p.recipe||[]});setEditing(true);window.scrollTo({top:0,behavior:'smooth'});}
  function toggle(id){setProducts(prev=>prev.map(p=>p.id===id?{...p,active:p.active===false?true:false}:p));}
  function saveRecipe(recipe){setProducts(prev=>prev.map(p=>p.id===recipeProduct.id?{...p,recipe}:p));setRecipeProduct(null);}
  return <section className="screen"><button className="back" onClick={back}>← Quay lại</button><h2>Món & giá vốn</h2><p className="hint">Giá vốn có thể nhập trực tiếp. Nếu muốn tự trừ kho khi bán, thiết lập nguyên liệu sử dụng cho món.</p>
    <form className="form-card" onSubmit={submit}><label>Tên món<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ví dụ: Trà Ổi" /></label><label>Danh mục<input value={form.category} onChange={e=>setForm({...form,category:e.target.value})} placeholder="Ví dụ: Trà trái cây" /></label><div className="form-grid-2"><label>Giá bán<input type="number" value={form.price} onChange={e=>setForm({...form,price:e.target.value})} /></label><label>Giá vốn<input type="number" value={form.cost} onChange={e=>setForm({...form,cost:e.target.value})} placeholder="Có thể nhập sau" /></label></div><button className="primary full">{editing?'Lưu thay đổi':'+ Thêm món'}</button>{editing&&<button type="button" className="secondary full" onClick={()=>{setForm(empty);setEditing(false)}}>Bỏ chỉnh sửa</button>}</form>
    <div className="product-admin-list">{products.map(p=><div className="admin-row" key={p.id}><div><strong>{p.name}</strong><small>{p.category} · Bán {fmt(p.price)} · Vốn {fmt(p.cost)}</small><span className={p.active===false?'status cancel':'status'}>{p.active===false?'Đang ẩn':'Đang bán'}{p.recipe?.length?` · Trừ kho ${p.recipe.length} mục`:''}</span></div><div><button onClick={()=>setRecipeProduct(p)}>Trừ kho</button><button onClick={()=>edit(p)}>Sửa</button><button onClick={()=>toggle(p.id)}>{p.active===false?'Hiện':'Ẩn'}</button></div></div>)}</div>
    {recipeProduct&&<RecipeModal product={recipeProduct} ingredients={ingredients} onClose={()=>setRecipeProduct(null)} onSave={saveRecipe}/>} 
  </section>
}

function RecipeModal({product,ingredients,onClose,onSave}){
  const [rows,setRows]=useState(product.recipe?.length?product.recipe:[{ingredientId:'',qty:''}]);
  function change(i,key,value){setRows(v=>v.map((r,idx)=>idx===i?{...r,[key]:value}:r));}
  function save(){const clean=rows.filter(r=>r.ingredientId&&Number(r.qty)>0).map(r=>({ingredientId:r.ingredientId,qty:Number(r.qty)}));onSave(clean);}
  return <Modal title={`Trừ kho · ${product.name}`} close={onClose}><p className="hint">Khi bán 1 món, hệ thống sẽ trừ đúng số lượng dưới đây. Tất cả nguyên liệu phải chọn từ Danh mục kho chung.</p>{!ingredients.length&&<div className="auth-message">Chưa có nguyên liệu. Hãy vào Kho để tạo danh mục trước.</div>}<div className="recipe-list">{rows.map((r,i)=><div className="recipe-row" key={i}><select value={r.ingredientId} onChange={e=>change(i,'ingredientId',e.target.value)}><option value="">Chọn nguyên liệu</option>{ingredients.map(x=><option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select><input type="number" step="0.01" min="0" value={r.qty} onChange={e=>change(i,'qty',e.target.value)} placeholder="SL"/><button onClick={()=>setRows(v=>v.filter((_,idx)=>idx!==i))}>×</button></div>)}</div><button className="secondary full" onClick={()=>setRows(v=>[...v,{ingredientId:'',qty:''}])}>+ Thêm nguyên liệu</button><button className="primary full" onClick={save}>Lưu cách trừ kho</button></Modal>
}

function FoodAppForm({form,setForm,onSubmit,back}) { return <section className="screen"><button className="back" onClick={back}>← Quay lại</button><h2>Nhập đơn từ App Food</h2><p className="hint">Nhập tổng cả ngày như một đơn. Có thể chọn ngày cũ để nhập bù.</p><form className="form-card" onSubmit={onSubmit}><label>Ngày bán<input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label><label>Ứng dụng<select value={form.app} onChange={e=>setForm({...form,app:e.target.value})}><option>GrabFood</option><option>ShopeeFood</option><option>Khác</option></select></label><label>Tổng số ly đã bán<input type="number" value={form.totalQty} onChange={e=>setForm({...form,totalQty:e.target.value})} placeholder="Ví dụ: 24" /></label><label>Doanh thu thực nhận<input type="number" value={form.total} onChange={e=>setForm({...form,total:e.target.value})} placeholder="Sau khi đã trừ phí sàn / quảng cáo" /></label><label>Ghi chú<textarea value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="Có thể bỏ trống" /></label><button className="primary full">Lưu đơn</button></form></section> }

function OrderDrawer({order,onClose,onCancel,onSave}) {
  const [draft,setDraft]=useState({...order, subtotal:Number(order.subtotal ?? order.total ?? 0), discount:Number(order.discount || 0)});
  const draftSubtotal = Number(draft.subtotal ?? draft.total ?? 0);
  const draftDiscount = Math.max(0, Math.min(Number(draft.discount || 0), draftSubtotal));
  const draftTotal = draftSubtotal - draftDiscount;
  function save(){ onSave({...draft, discount:draftDiscount, total:draftTotal}); }
  return <div className="overlay" onClick={onClose}><aside className="drawer" onClick={e=>e.stopPropagation()}><div className="drawer-head"><div><small>MÃ ĐƠN</small><strong>{order.id}</strong></div><button onClick={onClose}>×</button></div><div className="detail-grid"><div><small>Ngày bán</small><strong>{draft.date}</strong></div><div><small>Nguồn</small><strong>{draft.source}</strong></div><label><small>Số ly / sản phẩm</small><input type="number" value={draft.totalQty} onChange={e=>setDraft({...draft,totalQty:Number(e.target.value)})}/></label><label><small>Tạm tính</small><input type="number" value={draftSubtotal} onChange={e=>setDraft({...draft,subtotal:Number(e.target.value)})}/></label><label><small>Giảm giá</small><input type="number" min="0" value={draft.discount||0} onChange={e=>setDraft({...draft,discount:Number(e.target.value)})}/></label><div><small>Khách thanh toán</small><strong>{fmt(draftTotal)}</strong></div></div>{draft.items?.length>0&&<div className="card flat"><div className="section-title">Chi tiết món</div>{draft.items.map((x,i)=><div className="summary-line" key={i}><span>{x.name} × {x.qty}</span><strong>{fmt(x.price*x.qty)}</strong></div>)}</div>}<label className="drawer-note"><small>Ghi chú</small><textarea value={draft.note||''} onChange={e=>setDraft({...draft,note:e.target.value})}/></label><button className="primary full" onClick={save}>Lưu chỉnh sửa</button>{order.status!=='Đã hủy'&&<button className="danger full" onClick={()=>onCancel(order.id)}>Hủy đơn</button>}</aside></div> }

function Stock({ingredients,setIngredients,receipts,setReceipts,counts,setCounts,adjustments,setAdjustments}){
  const [tab,setTab]=useState('inventory'); const [modal,setModal]=useState(null);
  const [ingForm,setIngForm]=useState({id:null,name:'',type:'Nguyên liệu',unit:'g',qty:'',minQty:''});
  const [receipt,setReceipt]=useState({date:todayISO(),ingredientId:'',qty:'',total:'',payment:'Chuyển khoản'});
  const [count,setCount]=useState({date:todayISO(),ingredientId:'',actual:'',note:''});
  const [adjust,setAdjust]=useState({date:todayISO(),ingredientId:'',qty:'',reason:'Hư hao',note:''});
  const ingMap=Object.fromEntries(ingredients.map(x=>[x.id,x]));
  function saveIngredient(e){e.preventDefault(); if(!ingForm.name.trim())return; const item={...ingForm,id:ingForm.id||`NL-${Date.now()}`,qty:Number(ingForm.qty||0),minQty:Number(ingForm.minQty||0)}; setIngredients(v=>ingForm.id?v.map(x=>x.id===item.id?item:x):[...v,item]);setIngForm({id:null,name:'',type:'Nguyên liệu',unit:'g',qty:'',minQty:''});setModal(null);}
  function editIngredient(x){setIngForm({...x});setModal('ingredient');}
  function saveReceipt(e){e.preventDefault(); const q=Number(receipt.qty||0);if(!receipt.ingredientId||q<=0)return alert('Chọn nguyên liệu và nhập số lượng.');setIngredients(v=>v.map(x=>x.id===receipt.ingredientId?{...x,qty:Number(x.qty||0)+q}:x));setReceipts(v=>[{id:`PN-${Date.now()}`,...receipt,qty:q,total:Number(receipt.total||0)},...v]);setReceipt({date:todayISO(),ingredientId:'',qty:'',total:'',payment:'Chuyển khoản'});setModal(null);}
  function saveCount(e){e.preventDefault();const ing=ingMap[count.ingredientId];if(!ing)return;const actual=Number(count.actual||0),before=Number(ing.qty||0),diff=actual-before;setIngredients(v=>v.map(x=>x.id===ing.id?{...x,qty:actual}:x));setCounts(v=>[{id:`KK-${Date.now()}`,...count,name:ing.name,unit:ing.unit,before,actual,diff},...v]);setCount({date:todayISO(),ingredientId:'',actual:'',note:''});setModal(null);}
  function saveAdjust(e){e.preventDefault();const ing=ingMap[adjust.ingredientId];const q=Number(adjust.qty||0);if(!ing||!q)return;setIngredients(v=>v.map(x=>x.id===ing.id?{...x,qty:Number(x.qty||0)+q}:x));setAdjustments(v=>[{id:`DC-${Date.now()}`,...adjust,name:ing.name,unit:ing.unit,qty:q},...v]);setAdjust({date:todayISO(),ingredientId:'',qty:'',reason:'Hư hao',note:''});setModal(null);}
  const history=[...receipts.map(x=>({...x,kind:'Nhập hàng',name:ingMap[x.ingredientId]?.name||'Nguyên liệu',unit:ingMap[x.ingredientId]?.unit||''})),...counts.map(x=>({...x,kind:'Kiểm kê',qty:x.diff})),...adjustments.map(x=>({...x,kind:x.reason==='Bán hàng'?'Bán hàng':'Điều chỉnh'}))].sort((a,b)=>String(b.id).localeCompare(String(a.id)));
  return <section className="screen stock-screen"><div className="screen-head"><div><h2>Kho</h2><p>Một danh mục dùng chung cho nhập hàng, kiểm kê và trừ kho</p></div><button className="primary small" onClick={()=>setModal('ingredient')}>+ Nguyên liệu</button></div><div className="segmented stock-tabs"><button className={tab==='inventory'?'active':''} onClick={()=>setTab('inventory')}>Tồn kho</button><button className={tab==='receipts'?'active':''} onClick={()=>setTab('receipts')}>Nhập hàng</button><button className={tab==='counts'?'active':''} onClick={()=>setTab('counts')}>Kiểm kê</button><button className={tab==='history'?'active':''} onClick={()=>setTab('history')}>Lịch sử</button></div>
  {tab==='inventory'&&<><div className="quick-actions stock-actions"><button onClick={()=>setModal('receipt')}>+ Nhập hàng</button><button onClick={()=>setModal('count')}>Kiểm kê</button><button onClick={()=>setModal('adjust')}>Điều chỉnh</button></div><div className="card stock-list">{ingredients.length?ingredients.map(x=><div className="stock-row" key={x.id} onClick={()=>editIngredient(x)}><div><strong>{x.name}</strong><small>{x.type} · {x.unit}{Number(x.minQty)>0&&Number(x.qty)<=Number(x.minQty)?' · ⚠ Sắp hết':''}</small></div><span>{x.qty} {x.unit}<small>Chạm để sửa</small></span></div>):<div className="empty">Chưa có nguyên liệu hoặc bao bì. Bấm “+ Nguyên liệu” để tạo.</div>}</div></>}
  {tab==='receipts'&&<><button className="primary full" onClick={()=>setModal('receipt')}>+ Tạo phiếu nhập hàng</button><div className="card stock-list">{receipts.length?receipts.map(r=><div className="stock-row" key={r.id}><div><strong>{ingMap[r.ingredientId]?.name||'Nguyên liệu'}</strong><small>{r.date} · {r.payment}</small></div><span>+{r.qty} {ingMap[r.ingredientId]?.unit||''}<small>{r.total?fmt(r.total):''}</small></span></div>):<div className="empty">Chưa có phiếu nhập.</div>}</div></>}
  {tab==='counts'&&<><button className="primary full" onClick={()=>setModal('count')}>+ Kiểm kê kho</button><div className="card stock-list">{counts.length?counts.map(c=><div className="stock-row" key={c.id}><div><strong>{c.name}</strong><small>{c.date} · Hệ thống {c.before} {c.unit}</small></div><span>{c.actual} {c.unit}<small>Lệch {c.diff>0?'+':''}{c.diff}</small></span></div>):<div className="empty">Chưa có lần kiểm kê.</div>}</div></>}
  {tab==='history'&&<div className="card stock-list">{history.length?history.map(h=><div className="stock-row" key={h.id}><div><strong>{h.kind} · {h.name||ingMap[h.ingredientId]?.name||''}</strong><small>{h.date}{h.reason&&h.kind!=='Bán hàng'?` · ${h.reason}`:''}{h.refId?` · ${h.refId}`:''}</small></div><span>{Number(h.qty)>0?'+':''}{h.qty} {h.unit||ingMap[h.ingredientId]?.unit||''}</span></div>):<div className="empty">Chưa có lịch sử kho.</div>}</div>}
  {modal==='ingredient'&&<Modal title={ingForm.id?'Sửa nguyên liệu':'Thêm nguyên liệu'} close={()=>{setModal(null);setIngForm({id:null,name:'',type:'Nguyên liệu',unit:'g',qty:'',minQty:''})}}><form className="form-card plain" onSubmit={saveIngredient}><label>Tên<input required value={ingForm.name} onChange={e=>setIngForm({...ingForm,name:e.target.value})} placeholder="Ví dụ: Matcha / Ly 1L"/></label><label>Loại<select value={ingForm.type} onChange={e=>setIngForm({...ingForm,type:e.target.value})}><option>Nguyên liệu</option><option>Bao bì</option></select></label><label>Đơn vị<select value={ingForm.unit} onChange={e=>setIngForm({...ingForm,unit:e.target.value})}><option>g</option><option>kg</option><option>ml</option><option>lít</option><option>cái</option><option>gói</option><option>hộp</option><option>chai</option></select></label><div className="form-grid-2"><label>Tồn hiện tại<input type="number" step="0.01" value={ingForm.qty} onChange={e=>setIngForm({...ingForm,qty:e.target.value})}/></label><label>Cảnh báo dưới<input type="number" step="0.01" value={ingForm.minQty} onChange={e=>setIngForm({...ingForm,minQty:e.target.value})}/></label></div><button className="primary full">Lưu</button></form></Modal>}
  {modal==='receipt'&&<Modal title="Phiếu nhập hàng" close={()=>setModal(null)}><form className="form-card plain" onSubmit={saveReceipt}><label>Ngày nhập<input type="date" value={receipt.date} onChange={e=>setReceipt({...receipt,date:e.target.value})}/></label><label>Nguyên liệu / bao bì<select required value={receipt.ingredientId} onChange={e=>setReceipt({...receipt,ingredientId:e.target.value})}><option value="">Chọn từ danh mục kho</option>{ingredients.map(x=><option key={x.id} value={x.id}>{x.name} · {x.unit}</option>)}</select></label><label>Số lượng<input required type="number" step="0.01" value={receipt.qty} onChange={e=>setReceipt({...receipt,qty:e.target.value})}/></label><label>Tổng tiền<input type="number" value={receipt.total} onChange={e=>setReceipt({...receipt,total:e.target.value})}/></label><label>Thanh toán<select value={receipt.payment} onChange={e=>setReceipt({...receipt,payment:e.target.value})}><option>Tiền mặt</option><option>Chuyển khoản</option></select></label><button className="primary full">Lưu phiếu nhập</button></form></Modal>}
  {modal==='count'&&<Modal title="Kiểm kê kho" close={()=>setModal(null)}><form className="form-card plain" onSubmit={saveCount}><label>Nguyên liệu / bao bì<select required value={count.ingredientId} onChange={e=>setCount({...count,ingredientId:e.target.value})}><option value="">Chọn từ danh mục kho</option>{ingredients.map(x=><option key={x.id} value={x.id}>{x.name} · hệ thống {x.qty} {x.unit}</option>)}</select></label><label>Tồn thực tế<input required type="number" step="0.01" value={count.actual} onChange={e=>setCount({...count,actual:e.target.value})}/></label><label>Ghi chú<textarea value={count.note} onChange={e=>setCount({...count,note:e.target.value})}/></label><button className="primary full">Xác nhận kiểm kê</button></form></Modal>}
  {modal==='adjust'&&<Modal title="Điều chỉnh kho" close={()=>setModal(null)}><form className="form-card plain" onSubmit={saveAdjust}><label>Nguyên liệu / bao bì<select required value={adjust.ingredientId} onChange={e=>setAdjust({...adjust,ingredientId:e.target.value})}><option value="">Chọn từ danh mục kho</option>{ingredients.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Số lượng<input required type="number" step="0.01" value={adjust.qty} onChange={e=>setAdjust({...adjust,qty:e.target.value})} placeholder="Ví dụ -2 nếu hao hụt"/></label><label>Lý do<select value={adjust.reason} onChange={e=>setAdjust({...adjust,reason:e.target.value})}><option>Hư hao</option><option>Pha thử</option><option>Đổ / làm sai</option><option>Nhập thiếu trước đó</option><option>Khác</option></select></label><label>Ghi chú<textarea value={adjust.note} onChange={e=>setAdjust({...adjust,note:e.target.value})}/></label><button className="primary full">Lưu điều chỉnh</button></form></Modal>}
  </section>
}

function Modal({title,close,children}){return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div className="modal-card"><div className="modal-head"><h3>{title}</h3><button onClick={close}>×</button></div>{children}</div></div>}

function Cash(){return <section className="screen"><h2>Thu chi</h2><div className="grid-2"><div className="card"><div className="muted">TIỀN VÀO</div><div className="money">40.000.000đ</div></div><div className="card"><div className="muted">TIỀN RA</div><div className="money">35.000.000đ</div></div></div><div className="card"><div className="section-title">Danh mục chi</div><div className="tag-list"><span>Mua nguyên liệu</span><span>Nhân viên</span><span>Mặt bằng</span><span>Điện nước</span><span>Quảng cáo</span><span>Khác</span></div><p className="hint">Có danh mục mặc định và chủ quán có thể tự thêm.</p></div></section>}
function Reports({orders}){const valid=orders.filter(o=>o.status!=='Đã hủy'); const revenue=valid.reduce((s,o)=>s+Number(o.total||0),0); return <section className="screen"><h2>Báo cáo</h2><div className="card"><div className="muted">TỔNG DOANH THU ĐANG GHI NHẬN</div><div className="big-number">{fmt(revenue)}</div></div><div className="report-menu"><button>Kết quả kinh doanh <span>›</span></button><button>Sản phẩm bán ra <span>›</span></button><button>Nguồn bán <span>›</span></button><button>Chênh lệch kho <span>›</span></button></div></section>}
function More({go,user,onSignOut,syncState}){return <section className="screen"><h2>Thêm</h2><div className="card account-card"><div><div className="muted">TÀI KHOẢN</div><strong>Admin · Chủ quán</strong><small>{syncState==='saving'?'Đang đồng bộ dữ liệu…':syncState==='error'?'Có lỗi đồng bộ':'Dữ liệu đã đồng bộ'}</small></div><button className="secondary" onClick={onSignOut}>Đăng xuất</button></div><div className="report-menu"><button onClick={()=>go('foodapp')}>Nhập đơn từ App Food <span>›</span></button><button onClick={()=>go('products')}>Món & giá vốn <span>›</span></button><button onClick={()=>go('stock')}>Nguyên liệu & kho <span>›</span></button><button>Cài đặt danh mục chi <span>›</span></button></div></section>}
