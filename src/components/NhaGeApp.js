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
  const [screen, setScreen] = useState('order');
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
  const [foodForm, setFoodForm] = useState({ date: todayISO(), app: 'Grab Food', total: '', note: '' });
  const [foodCart, setFoodCart] = useState([]);
  const defaultExpenseCategories = ['Nhân viên','Mặt bằng','Điện nước','Quảng cáo','Vận chuyển','Sửa chữa','Phần mềm','Khác'];
  const [cashTransactions,setCashTransactions] = useState([]);
  const [expenseCategories,setExpenseCategories] = useState(defaultExpenseCategories);
  const [openingBalances,setOpeningBalances] = useState({cash:0,bank:0});
  const [dayClosings,setDayClosings] = useState([]);



  useEffect(() => {
    if (!supabaseReady || !supabase) { setAuthLoading(false); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) { setUser(data.session?.user || null); setAuthLoading(false); }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      if (!session?.user) { setDataReady(false); setOrders([]); setProducts(initialProducts); setIngredients([]); setStockReceipts([]); setStockCounts([]); setStockAdjustments([]); setCashTransactions([]); setExpenseCategories(defaultExpenseCategories); setOpeningBalances({cash:0,bank:0}); setDayClosings([]); }
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!user || !supabase) return;
    let alive = true;
    setDataReady(false); setSyncState('saving'); setSyncError('');
    (async () => {
      const { data, error } = await supabase.from('app_states').select('products,orders,ingredients,stock_receipts,stock_counts,stock_adjustments,cash_transactions,expense_categories,opening_balances,day_closings').eq('user_id', user.id).maybeSingle();
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
        setCashTransactions(Array.isArray(data.cash_transactions) ? data.cash_transactions : []);
        setExpenseCategories(Array.isArray(data.expense_categories) && data.expense_categories.length ? data.expense_categories : defaultExpenseCategories);
        setOpeningBalances(data.opening_balances && typeof data.opening_balances==='object' ? data.opening_balances : {cash:0,bank:0});
        setDayClosings(Array.isArray(data.day_closings) ? data.day_closings : []);
      } else {
        const firstIngredients = mergeImportedIngredients([]);
        const firstProducts = applyImportedRecipes(initialProducts, firstIngredients);
        const { error: createError } = await supabase.from('app_states').insert({ user_id:user.id, products:firstProducts, orders:[], ingredients:firstIngredients, stock_receipts:[], stock_counts:[], stock_adjustments:[], cash_transactions:[], expense_categories:defaultExpenseCategories, opening_balances:{cash:0,bank:0}, day_closings:[] });
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
      const { error } = await supabase.from('app_states').upsert({ user_id:user.id, products, orders, ingredients, stock_receipts:stockReceipts, stock_counts:stockCounts, stock_adjustments:stockAdjustments, cash_transactions:cashTransactions, expense_categories:expenseCategories, opening_balances:openingBalances, day_closings:dayClosings, updated_at:new Date().toISOString() });
      if (error) { setSyncState('error'); setSyncError(error.message); }
      else { setSyncState('saved'); setSyncError(''); }
    }, 500);
    return () => clearTimeout(timer);
  }, [products, orders, ingredients, stockReceipts, stockCounts, stockAdjustments, cashTransactions, expenseCategories, openingBalances, dayClosings, user?.id, dataReady]);

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
  function addFoodProduct(p) {
    setFoodCart(prev => {
      const found = prev.find(x => x.id === p.id);
      if (found) return prev.map(x => x.id === p.id ? { ...x, qty: x.qty + 1 } : x);
      return [...prev, { ...p, qty: 1 }];
    });
  }
  function changeFoodQty(id, delta) {
    setFoodCart(prev => prev.map(x => x.id === id ? { ...x, qty: Math.max(0, x.qty + delta) } : x).filter(x => x.qty > 0));
  }
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
    e.preventDefault();
    if (!foodCart.length) return alert('Vui lòng chọn ít nhất 1 món đã bán trên App Food.');
    if (!foodForm.total) return alert('Vui lòng nhập doanh thu thực nhận.');
    const items = foodCart.map(x=>({productId:x.id,name:x.name,qty:x.qty,price:x.price,cost:x.cost||0}));
    const totalQty = items.reduce((s,x)=>s+Number(x.qty||0),0);
    const id = `APP-${Date.now()}`;
    const stockMovements = applyStockChange(items, -1, id, 'Bán hàng App Food');
    const order = {
      id, date:foodForm.date,
      time:new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'}),
      source:foodForm.app, payment:'App Food', status:'Hoàn tất',
      items, stockMovements, totalQty,
      subtotal:Number(foodForm.total), discount:0, total:Number(foodForm.total),
      note:foodForm.note||'Nhập tổng cuối ngày'
    };
    setOrders(prev => [order, ...prev]);
    setFoodForm({ date:todayISO(), app:'Grab Food', total:'', note:'' });
    setFoodCart([]);
    setScreen('order'); setOrderTab('list');
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
    <header className="topbar"><div><div className="brand">TIỆM NHÀ GÉ</div><div className="date">Quản lý quán · Bản 0.13 · <span className={'sync '+syncState}>{syncState==='saving'?'Đang đồng bộ…':syncState==='error'?'Lỗi đồng bộ':'Đã đồng bộ'}</span></div></div><button className="icon-btn" onClick={() => setScreen('more')}>⋯</button></header>
    <main>
      <div className="page-transition" key={screen}>
      {screen === 'home' && <Home todayRevenue={todayRevenue} dayOrders={dayOrders} todayQty={todayQty} cashToday={cashToday} bankToday={bankToday} knownCostToday={knownCostToday} ingredients={ingredients} closings={dayClosings} go={setScreen} openOrders={() => {setScreen('order');setOrderTab('list')}} />}
      {screen === 'order' && <OrdersScreen products={products.filter(p=>p.active!==false)} tab={orderTab} setTab={setOrderTab} cart={cart} addProduct={addProduct} changeQty={changeQty} payment={payment} setPayment={setPayment} discount={discount} setDiscount={setDiscount} completeOrder={completeOrder} orders={orders} openOrder={setSelectedOrder} goFood={() => setScreen('foodapp')} />}
      {screen === 'foodapp' && <FoodAppForm form={foodForm} setForm={setFoodForm} products={products.filter(p=>p.active!==false)} cart={foodCart} addProduct={addFoodProduct} changeQty={changeFoodQty} onSubmit={saveFoodOrder} back={() => {setScreen('order');setOrderTab('list')}} />}
      {screen === 'products' && <ProductManager products={products} setProducts={setProducts} ingredients={ingredients} back={()=>setScreen('more')} />}
      {screen === 'stock' && <Stock ingredients={ingredients} setIngredients={setIngredients} receipts={stockReceipts} setReceipts={setStockReceipts} counts={stockCounts} setCounts={setStockCounts} adjustments={stockAdjustments} setAdjustments={setStockAdjustments} />}{screen === 'cash' && <Cash orders={orders} receipts={stockReceipts} transactions={cashTransactions} setTransactions={setCashTransactions} categories={expenseCategories} setCategories={setExpenseCategories} openingBalances={openingBalances} setOpeningBalances={setOpeningBalances} />}{screen === 'reports' && <Reports orders={orders} products={products} receipts={stockReceipts} transactions={cashTransactions} />}
      {screen === 'closeDay' && <CloseDay orders={orders} receipts={stockReceipts} transactions={cashTransactions} closings={dayClosings} setClosings={setDayClosings} back={()=>setScreen('home')} />}
      {screen === 'more' && <More go={setScreen} user={user} onSignOut={signOut} syncState={syncState} />}
      </div>
    </main>
    <nav className="bottom-nav">
      <Nav active={screen==='stock'} icon="▦" label="Kho" onClick={()=>setScreen('stock')} />
      <Nav active={screen==='order'} icon="＋" label="Order" onClick={()=>setScreen('order')} />
      <Nav active={screen==='home'} icon="⌂" label="Trang chủ" onClick={()=>setScreen('home')} />
      <Nav active={screen==='cash'} icon="₫" label="Thu chi" onClick={()=>setScreen('cash')} />
      <Nav active={screen==='reports'} icon="▤" label="Báo cáo" onClick={()=>setScreen('reports')} />
    </nav>
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
function SetupScreen(){ return <div className="auth-shell"><div className="auth-card"><h1>Chưa kết nối dữ liệu</h1><p>Bản 0.13 cần thêm thông tin kết nối Supabase trên Vercel trước khi đăng nhập được.</p><div className="auth-message">Cần 2 biến: NEXT_PUBLIC_SUPABASE_URL và NEXT_PUBLIC_SUPABASE_ANON_KEY.</div></div></div> }
function SyncErrorScreen({message}){ return <div className="auth-shell"><div className="auth-card"><h1>Chưa tải được dữ liệu</h1><p>Hãy kiểm tra đã chạy file <b>supabase.sql</b> trong Supabase chưa.</p><div className="auth-message">{message}</div></div></div> }

function Nav({active,icon,label,onClick}) { return <button className={'nav-item '+(active?'active':'')} onClick={onClick}><span>{icon}</span><small>{label}</small></button> }

function Home({todayRevenue,dayOrders,todayQty,cashToday,bankToday,knownCostToday,ingredients,closings,go,openOrders}) {
  const lowStock = (ingredients||[]).filter(x => Number(x.minQty||0)>0 && Number(x.qty||0)<=Number(x.minQty||0));
  const closedToday=(closings||[]).some(x=>x.date===todayISO());
  return <section className="screen">
    <div className="card hero"><div className="muted">DOANH THU HÔM NAY</div><div className="big-number">{fmt(todayRevenue)}</div><div className="stats-row"><div><strong>{dayOrders.length}</strong><span>đơn</span></div><div><strong>{todayQty}</strong><span>ly / sản phẩm</span></div></div></div>
    <div className="grid-2"><div className="card"><div className="muted">TIỀN MẶT</div><div className="money">{fmt(cashToday)}</div></div><div className="card"><div className="muted">CHUYỂN KHOẢN</div><div className="money">{fmt(bankToday)}</div></div></div>
    <div className="card"><div className="section-title">Lợi nhuận tạm tính</div><div className="profit">{fmt(Math.max(todayRevenue-knownCostToday,0))}</div><div className="summary-line"><span>Doanh thu</span><strong>{fmt(todayRevenue)}</strong></div><div className="summary-line"><span>Giá vốn đã biết</span><strong>-{fmt(knownCostToday)}</strong></div></div>
    <div className={'card stock-alert-card '+(lowStock.length?'warning':'ok')}>
      <div className="stock-alert-head"><div><div className="section-title">Cảnh báo tồn kho</div><p>{lowStock.length?`${lowStock.length} mục đang ở mức cần bổ sung`:'Kho hiện chưa có mục nào dưới mức cảnh báo.'}</p></div><button className="secondary" onClick={()=>go('stock')}>Xem kho</button></div>
      {lowStock.length>0&&<div className="home-stock-alerts">{lowStock.slice(0,5).map(x=><div className="home-stock-row" key={x.id}><span>⚠ {x.name}</span><strong>{x.qty} {x.unit}</strong></div>)}{lowStock.length>5&&<div className="hint">Còn {lowStock.length-5} mục khác đang cảnh báo.</div>}</div>}
    </div>
    <div className="quick-actions"><button onClick={openOrders}>Danh sách đơn</button><button onClick={()=>go('foodapp')}>Nhập đơn App Food</button><button onClick={()=>go('closeDay')}>{closedToday?'✓ Đã chốt ngày':'Chốt ngày'}</button></div>
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

function FoodAppForm({form,setForm,products,cart,addProduct,changeQty,onSubmit,back}) {
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('Tất cả');
  const categories=['Tất cả',...Array.from(new Set(products.map(p=>p.category).filter(Boolean)))];
  const shown=products.filter(p=>(category==='Tất cả'||p.category===category)&&p.name.toLowerCase().includes(query.toLowerCase()));
  const totalQty=cart.reduce((s,x)=>s+Number(x.qty||0),0);
  const retailTotal=cart.reduce((s,x)=>s+Number(x.price||0)*Number(x.qty||0),0);

  return <section className="screen food-screen">
    <button className="back" onClick={back}>← Quay lại</button>
    <div>
      <h2>Nhập đơn từ App Food</h2>
      <p className="hint">Chọn món giống khi bán tại quán. Cuối cùng nhập doanh thu thực nhận từ ứng dụng.</p>
    </div>

    <div className="food-layout">
      <div className="food-products-area">
        <div className="form-card compact-food-info">
          <label>Ngày bán<input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label>
          <label>Ứng dụng<select value={form.app} onChange={e=>setForm({...form,app:e.target.value})}>
            <option>Grab Food</option><option>Shopee Food</option><option>Green Food</option><option>Be Food</option><option>Khác</option>
          </select></label>
        </div>

        <div className="searchbar"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm món..." /></div>
        <div className="chips">{categories.map(c=><button type="button" key={c} className={'chip '+(category===c?'active':'')} onClick={()=>setCategory(c)}>{c}</button>)}</div>
        <div className="products">{shown.map(p=><button type="button" className="product" key={p.id} onClick={()=>addProduct(p)}><span>{p.name}</span><strong>{fmt(p.price)}</strong></button>)}</div>
      </div>

      <form className="card food-current-order" onSubmit={onSubmit}>
        <div className="section-title food-order-title">Đơn hiện tại</div>

        {!cart.length && <div className="empty">Chưa chọn món.</div>}

        <div className="food-order-lines">
          {cart.map(x=><div className="food-order-line" key={x.id}>
            <div className="food-line-info">
              <strong>{x.name}</strong>
              <span>{fmt(x.price)}</span>
            </div>
            <div className="qty-control food-qty">
              <button type="button" onClick={()=>changeQty(x.id,-1)}>−</button>
              <strong>{x.qty}</strong>
              <button type="button" onClick={()=>changeQty(x.id,1)}>+</button>
            </div>
          </div>)}
        </div>

        <div className="food-order-total">
          <span>Tổng giá bán tại quán</span>
          <strong>{fmt(retailTotal)}</strong>
        </div>
        <div className="food-order-count">
          <span>Số lượng</span>
          <strong>{totalQty} ly / sản phẩm</strong>
        </div>

        <label className="food-received">Doanh thu thực nhận
          <input type="number" value={form.total} onChange={e=>setForm({...form,total:e.target.value})} placeholder="0" />
          <small>Số tiền còn lại sau phí sàn / quảng cáo.</small>
        </label>

        <label>Ghi chú
          <textarea value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="Có thể bỏ trống" />
        </label>

        <button className="primary full food-submit" disabled={!cart.length}>Hoàn tất đơn App Food</button>
      </form>
    </div>
  </section>
}

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

function Modal({title,close,children,className=''}){return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div className={'modal-card '+className}><div className="modal-head"><h3>{title}</h3><button onClick={close}>×</button></div>{children}</div></div>}

function Cash({orders,receipts,transactions,setTransactions,categories,setCategories,openingBalances,setOpeningBalances}){
  const [tab,setTab]=useState('all');
  const [showForm,setShowForm]=useState(false);
  const [showCategory,setShowCategory]=useState(false);
  const [showOpening,setShowOpening]=useState(false);
  const [openingForm,setOpeningForm]=useState({cash:String(openingBalances?.cash||0),bank:String(openingBalances?.bank||0)});
  const [form,setForm]=useState({type:'Chi',category:'Khác',amount:'',payment:'Chuyển khoản',date:todayISO(),note:''});
  const [newCategory,setNewCategory]=useState('');

  const validOrders=(orders||[]).filter(o=>o.status!=='Đã hủy');
  const orderIncome=validOrders.map(o=>({
    id:'ORDER-'+o.id,
    date:o.date,
    type:'Thu',
    category:o.source==='Tại quán'?'Order tại quán':'App Food',
    amount:Number(o.total||0),
    payment:o.payment,
    note:o.source,
    auto:true
  }));
  const receiptOut=(receipts||[]).filter(r=>Number(r.total||0)>0).map(r=>({
    id:'RECEIPT-'+r.id,
    date:r.date,
    type:'Chi',
    category:'Mua nguyên liệu',
    amount:Number(r.total||0),
    payment:r.payment||'Chuyển khoản',
    note:'Phiếu nhập hàng',
    auto:true
  }));
  const all=[...orderIncome,...receiptOut,...(transactions||[])].sort((a,b)=>(String(b.date)+String(b.id)).localeCompare(String(a.date)+String(a.id)));
  const income=all.filter(x=>x.type==='Thu').reduce((s,x)=>s+Number(x.amount||0),0);
  const outcome=all.filter(x=>x.type==='Chi').reduce((s,x)=>s+Number(x.amount||0),0);
  const balance=income-outcome;
  const isBankPayment=(p)=>p==='Chuyển khoản'||p==='App Food'||p==='Grab Food'||p==='Shopee Food'||p==='Green Food'||p==='Be Food';
  const cashIn=all.filter(x=>x.type==='Thu'&&x.payment==='Tiền mặt').reduce((s,x)=>s+Number(x.amount||0),0);
  const cashOut=all.filter(x=>x.type==='Chi'&&x.payment==='Tiền mặt').reduce((s,x)=>s+Number(x.amount||0),0);
  const bankIn=all.filter(x=>x.type==='Thu'&&isBankPayment(x.payment)).reduce((s,x)=>s+Number(x.amount||0),0);
  const bankOut=all.filter(x=>x.type==='Chi'&&isBankPayment(x.payment)).reduce((s,x)=>s+Number(x.amount||0),0);
  const currentCash=Number(openingBalances?.cash||0)+cashIn-cashOut;
  const currentBank=Number(openingBalances?.bank||0)+bankIn-bankOut;
  const currentTotal=currentCash+currentBank;

  const shown=all.filter(x=>tab==='all'||(tab==='income'&&x.type==='Thu')||(tab==='expense'&&x.type==='Chi'));

  function saveTransaction(e){
    e.preventDefault();
    if(!form.amount||Number(form.amount)<=0)return alert('Vui lòng nhập số tiền.');
    setTransactions(prev=>[{
      id:'TC-'+Date.now(),
      ...form,
      amount:Number(form.amount)
    },...prev]);
    setForm({type:'Chi',category:'Khác',amount:'',payment:'Chuyển khoản',date:todayISO(),note:''});
    setShowForm(false);
  }
  function removeManual(id){
    if(!confirm('Xóa khoản thu/chi này?'))return;
    setTransactions(prev=>prev.filter(x=>x.id!==id));
  }
  function addCategory(e){
    e.preventDefault();
    const name=newCategory.trim();
    if(!name)return;
    if(!categories.includes(name))setCategories(prev=>[...prev,name]);
    setNewCategory('');
  }

  function renameCategory(oldName){
    const next=prompt('Đổi tên danh mục',oldName);
    if(next===null)return;
    const name=next.trim();
    if(!name||name===oldName)return;
    if(categories.includes(name))return alert('Danh mục này đã tồn tại.');
    setCategories(prev=>prev.map(c=>c===oldName?name:c));
    // Giữ nguyên giao dịch cũ để không làm thay đổi lịch sử.
  }
  function deleteCategory(name){
    if(!confirm(`Xóa danh mục "${name}" khỏi danh sách chọn? Giao dịch cũ vẫn được giữ nguyên.`))return;
    setCategories(prev=>prev.filter(c=>c!==name));
  }

  function moveCategoryStep(name,direction){
    setCategories(prev=>{
      const next=[...prev];
      const index=next.indexOf(name);
      const target=index+direction;
      if(index<0||target<0||target>=next.length)return prev;
      [next[index],next[target]]=[next[target],next[index]];
      return next;
    });
  }


  function saveOpening(e){
    e.preventDefault();
    setOpeningBalances({cash:Number(openingForm.cash||0),bank:Number(openingForm.bank||0)});
    setShowOpening(false);
  }

  return <section className="screen cash-screen">
    <div className="screen-head cash-head">
      <div><h2>Thu chi</h2><p>Theo dõi tiền thực tế vào và ra khỏi quán</p></div>
      <div className="cash-head-actions">
        <button className="secondary small" onClick={()=>setShowOpening(true)}>Số dư đầu kỳ</button>
        <button className="secondary small" onClick={()=>setShowCategory(true)}>Danh mục chi phí</button>
        <button className="primary small" onClick={()=>setShowForm(true)}>+ Ghi thu chi</button>
      </div>
    </div>

    <div className="cash-summary">
      <div className="card"><div className="muted">TIỀN VÀO</div><div className="money">{fmt(income)}</div></div>
      <div className="card"><div className="muted">TIỀN RA</div><div className="money">{fmt(outcome)}</div></div>
      <div className="card balance-card"><div className="muted">CHÊNH LỆCH DÒNG TIỀN</div><div className={'money '+(balance<0?'negative':'')}>{balance<0?'-':''}{fmt(Math.abs(balance))}</div></div>
      <div className="card wallet-card"><div className="muted">TIỀN MẶT HIỆN CÓ</div><div className={'money '+(currentCash<0?'negative':'')}>{currentCash<0?'-':''}{fmt(Math.abs(currentCash))}</div></div>
      <div className="card wallet-card"><div className="muted">CHUYỂN KHOẢN / APP</div><div className={'money '+(currentBank<0?'negative':'')}>{currentBank<0?'-':''}{fmt(Math.abs(currentBank))}</div></div>
      <div className="card wallet-card total-wallet"><div className="muted">TỔNG TIỀN ĐANG CÓ</div><div className={'money '+(currentTotal<0?'negative':'')}>{currentTotal<0?'-':''}{fmt(Math.abs(currentTotal))}</div></div>
    </div>

    <div className="card auto-note">
      <strong>Tự động ghi nhận</strong>
      <p>Đơn bán hàng/App Food được tính là tiền vào. Phiếu nhập hàng có số tiền được tính là tiền ra. Không cần nhập lại.</p>
    </div>

    <div className="segmented cash-tabs">
      <button className={tab==='all'?'active':''} onClick={()=>setTab('all')}>Tất cả</button>
      <button className={tab==='income'?'active':''} onClick={()=>setTab('income')}>Tiền vào</button>
      <button className={tab==='expense'?'active':''} onClick={()=>setTab('expense')}>Tiền ra</button>
    </div>

    <div className="card cash-list">
      {!shown.length&&<div className="empty">Chưa có giao dịch.</div>}
      {shown.map(x=><div className="cash-row" key={x.id}>
        <div className="cash-row-main">
          <strong>{x.category}</strong>
          <small>{x.date} · {x.payment}{x.auto?' · Tự động':''}</small>
          {x.note&&<span>{x.note}</span>}
        </div>
        <div className="cash-row-side">
          <strong className={x.type==='Chi'?'expense-money':'income-money'}>{x.type==='Chi'?'-':'+'}{fmt(x.amount)}</strong>
          {!x.auto&&<button onClick={()=>removeManual(x.id)}>Xóa</button>}
        </div>
      </div>)}
    </div>

    {showCategory&&<Modal title="Danh mục chi phí" close={()=>setShowCategory(false)} className="category-modal">
      <div className="category-modal-body">
        <p className="hint">Dùng nút ↑ / ↓ để sắp xếp thứ tự. Thứ tự này sẽ dùng trong ô chọn khi ghi khoản chi mới.</p>
        <div className="category-list category-order-list">
          {categories.map((c,index)=><div className="category-row" key={c}>
            <div className="category-move-buttons">
              <button type="button" disabled={index===0} onClick={()=>moveCategoryStep(c,-1)} title="Đưa lên">↑</button>
              <button type="button" disabled={index===categories.length-1} onClick={()=>moveCategoryStep(c,1)} title="Đưa xuống">↓</button>
            </div>
            <strong>{c}</strong>
            <div className="category-actions">
              <button type="button" onClick={()=>renameCategory(c)}>Sửa</button>
              <button type="button" className="category-delete" onClick={()=>deleteCategory(c)}>Xóa</button>
            </div>
          </div>)}
        </div>
        <form className="category-add" onSubmit={addCategory}>
          <input value={newCategory} onChange={e=>setNewCategory(e.target.value)} placeholder="Thêm danh mục mới"/>
          <button className="primary">Thêm</button>
        </form>
      </div>
    </Modal>}

    {showOpening&&<Modal title="Số dư đầu kỳ" close={()=>setShowOpening(false)} className="opening-modal">
      <form className="form-card plain" onSubmit={saveOpening}>
        <p className="hint">Nhập số tiền thực tế quán có tại thời điểm bắt đầu dùng hệ thống. Chỉ cần thiết lập một lần, sau này có thể chỉnh lại nếu cần.</p>
        <label>Tiền mặt<input type="number" value={openingForm.cash} onChange={e=>setOpeningForm({...openingForm,cash:e.target.value})}/></label>
        <label>Chuyển khoản / tài khoản ngân hàng<input type="number" value={openingForm.bank} onChange={e=>setOpeningForm({...openingForm,bank:e.target.value})}/></label>
        <button className="primary full">Lưu số dư đầu kỳ</button>
      </form>
    </Modal>}
    {showForm&&<Modal title="Ghi thu chi" close={()=>setShowForm(false)} className="cash-modal">
      <form className="form-card plain" onSubmit={saveTransaction}>
        <div className="segmented transaction-type">
          <button type="button" className={form.type==='Thu'?'active':''} onClick={()=>setForm({...form,type:'Thu',category:'Thu khác'})}>Tiền vào</button>
          <button type="button" className={form.type==='Chi'?'active':''} onClick={()=>setForm({...form,type:'Chi',category:'Khác'})}>Tiền ra</button>
        </div>
        <label>Ngày<input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label>
        <label>Danh mục
          {form.type==='Chi'
            ?<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{categories.map(c=><option key={c}>{c}</option>)}</select>
            :<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}><option>Thu khác</option><option>Góp vốn</option><option>Hoàn tiền</option></select>
          }
        </label>
        <label>Số tiền<input type="number" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} placeholder="0"/></label>
        <label>Thanh toán<select value={form.payment} onChange={e=>setForm({...form,payment:e.target.value})}><option>Tiền mặt</option><option>Chuyển khoản</option><option>Khác</option></select></label>
        <label>Ghi chú<textarea value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="Có thể bỏ trống"/></label>
        <button className="primary full">Lưu</button>
      </form>
    </Modal>}
  </section>
}

function Reports({orders,products,receipts=[],transactions=[]}){
  const today=todayISO();
  const [viewMode,setViewMode]=useState('month');
  const [month,setMonth]=useState(today.slice(0,7));
  const [day,setDay]=useState(today);
  const [tab,setTab]=useState('overview');

  const dateMatch=(date)=>{
    const d=String(date||'');
    return viewMode==='day' ? d===day : d.startsWith(month);
  };

  const validOrders=(orders||[]).filter(o=>o.status!=='Đã hủy' && dateMatch(o.date));
  const filteredReceipts=(receipts||[]).filter(r=>dateMatch(r.date));
  const filteredTransactions=(transactions||[]).filter(t=>dateMatch(t.date));

  const revenue=validOrders.reduce((s,o)=>s+Number(o.total||0),0);
  const grossSales=validOrders.reduce((s,o)=>s+Number(o.subtotal??o.total??0),0);
  const discounts=validOrders.reduce((s,o)=>s+Number(o.discount||0),0);
  const knownCost=validOrders.reduce((sum,o)=>sum+(o.items||[]).reduce((s,i)=>s+Number(i.cost||0)*Number(i.qty||0),0),0);
  const manualExpense=filteredTransactions.filter(x=>x.type==='Chi').reduce((s,x)=>s+Number(x.amount||0),0);
  const purchaseOut=filteredReceipts.reduce((s,x)=>s+Number(x.total||0),0);
  const otherIncome=filteredTransactions.filter(x=>x.type==='Thu').reduce((s,x)=>s+Number(x.amount||0),0);
  const operatingProfit=revenue-knownCost-manualExpense;
  const cashIn=revenue+otherIncome;
  const cashOut=purchaseOut+manualExpense;
  const cashNet=cashIn-cashOut;

  const bySource={};
  validOrders.forEach(o=>{
    const key=o.source||'Khác';
    if(!bySource[key])bySource[key]={orders:0,revenue:0,qty:0};
    bySource[key].orders+=1;
    bySource[key].revenue+=Number(o.total||0);
    bySource[key].qty+=Number(o.totalQty||0);
  });

  const byProduct={};
  validOrders.forEach(o=>(o.items||[]).forEach(i=>{
    const key=i.name||'Sản phẩm';
    if(!byProduct[key])byProduct[key]={qty:0,revenue:0,cost:0};
    byProduct[key].qty+=Number(i.qty||0);
    byProduct[key].revenue+=Number(i.price||0)*Number(i.qty||0);
    byProduct[key].cost+=Number(i.cost||0)*Number(i.qty||0);
  }));
  const productRows=Object.entries(byProduct).map(([name,v])=>({name,...v,profit:v.revenue-v.cost})).sort((a,b)=>b.revenue-a.revenue);
  const sourceRows=Object.entries(bySource).map(([name,v])=>({name,...v})).sort((a,b)=>b.revenue-a.revenue);

  const expenseRows={};
  filteredTransactions.filter(x=>x.type==='Chi').forEach(x=>{
    const key=x.category||'Khác';
    expenseRows[key]=(expenseRows[key]||0)+Number(x.amount||0);
  });
  const expenseList=Object.entries(expenseRows).map(([name,amount])=>({name,amount})).sort((a,b)=>b.amount-a.amount);

  // Doanh thu theo ngày trong tháng đang chọn
  const monthOrders=(orders||[]).filter(o=>o.status!=='Đã hủy' && String(o.date||'').startsWith(month));
  const dailyMap={};
  monthOrders.forEach(o=>{
    const d=String(o.date||'').slice(-2);
    dailyMap[d]=(dailyMap[d]||0)+Number(o.total||0);
  });
  const daysInMonth=(()=>{
    const [y,m]=month.split('-').map(Number);
    return new Date(y,m,0).getDate();
  })();
  const dailyRows=Array.from({length:daysInMonth},(_,i)=>{
    const d=String(i+1).padStart(2,'0');
    return {day:d,value:Number(dailyMap[d]||0)};
  });
  const maxDaily=Math.max(1,...dailyRows.map(x=>x.value));

  // So sánh nguồn bán theo tháng gần đây (6 tháng)
  const buildRecentMonths=()=>{
    const [y0,m0]=month.split('-').map(Number);
    const arr=[];
    for(let i=5;i>=0;i--){
      const d=new Date(y0,m0-1-i,1);
      arr.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    }
    return arr;
  };
  const recentMonths=buildRecentMonths();
  const knownSources=['Tại quán','Grab Food','Shopee Food','Green Food','Be Food','Khác'];
  const sourceMonthData={};
  knownSources.forEach(s=>sourceMonthData[s]={});
  (orders||[]).filter(o=>o.status!=='Đã hủy').forEach(o=>{
    const ym=String(o.date||'').slice(0,7);
    if(!recentMonths.includes(ym))return;
    const src=knownSources.includes(o.source)?o.source:'Khác';
    sourceMonthData[src][ym]=(sourceMonthData[src][ym]||0)+Number(o.total||0);
  });
  const maxSourceMonth=Math.max(1,...knownSources.flatMap(s=>recentMonths.map(m=>Number(sourceMonthData[s][m]||0))));

  const monthLabel=(ym)=>{
    const [y,m]=ym.split('-');
    return `T${Number(m)}/${y.slice(-2)}`;
  };

  return <section className="screen report-screen">
    <div className="screen-head report-head">
      <div><h2>Báo cáo</h2><p>Theo dõi doanh thu, lợi nhuận và dòng tiền</p></div>
      <div className="report-filter">
        <div className="segmented period-switch">
          <button className={viewMode==='day'?'active':''} onClick={()=>setViewMode('day')}>Theo ngày</button>
          <button className={viewMode==='month'?'active':''} onClick={()=>setViewMode('month')}>Theo tháng</button>
        </div>
        {viewMode==='day'
          ?<label className="date-box"><span>Ngày xem</span><input type="date" value={day} onChange={e=>setDay(e.target.value)}/></label>
          :<label className="date-box"><span>Tháng xem</span><select value={month} onChange={e=>setMonth(e.target.value)}>
            {Array.from({length:12},(_,i)=>{
              const y=new Date().getFullYear();
              const val=`${y}-${String(i+1).padStart(2,'0')}`;
              return <option key={val} value={val}>{`Tháng ${i+1}/${y}`}</option>
            })}
          </select></label>
        }
      </div>
    </div>

    <div className="segmented report-tabs">
      <button className={tab==='overview'?'active':''} onClick={()=>setTab('overview')}>Tổng quan</button>
      <button className={tab==='products'?'active':''} onClick={()=>setTab('products')}>Sản phẩm</button>
      <button className={tab==='sources'?'active':''} onClick={()=>setTab('sources')}>Nguồn bán</button>
      <button className={tab==='cash'?'active':''} onClick={()=>setTab('cash')}>Dòng tiền</button>
    </div>

    {tab==='overview'&&<>
      <div className="report-kpis colorful-kpis">
        <div className="card kpi-card kpi-orange"><div className="muted">DOANH THU</div><div className="money">{fmt(revenue)}</div></div>
        <div className="card kpi-card kpi-blue"><div className="muted">GIÁ VỐN ĐÃ BIẾT</div><div className="money">{fmt(knownCost)}</div></div>
        <div className="card kpi-card kpi-purple"><div className="muted">CHI PHÍ KHÁC</div><div className="money">{fmt(manualExpense)}</div></div>
        <div className="card kpi-card kpi-green"><div className="muted">LỢI NHUẬN TẠM TÍNH</div><div className={'money '+(operatingProfit<0?'negative':'')}>{operatingProfit<0?'-':''}{fmt(Math.abs(operatingProfit))}</div></div>
      </div>

      <div className="card revenue-chart-card">
        <div className="chart-head">
          <div><div className="section-title">Doanh thu từng ngày</div><p>So sánh doanh thu trong tháng {month.split('-')[1]}/{month.split('-')[0]}</p></div>
          <strong>{fmt(monthOrders.reduce((s,o)=>s+Number(o.total||0),0))}</strong>
        </div>
        <div className="bar-chart daily-chart">
          {dailyRows.map(x=><div className="bar-col" key={x.day} title={`Ngày ${x.day}: ${fmt(x.value)}`}>
            <div className="bar-wrap"><div className="bar-value" style={{height:`${Math.max(x.value?6:0,(x.value/maxDaily)*100)}%`}}></div></div>
            <small>{Number(x.day)}</small>
          </div>)}
        </div>
        <div className="mobile-daily-summary">
          {dailyRows.filter(x=>x.value>0).sort((a,b)=>b.value-a.value).slice(0,5).map(x=>
            <div key={x.day}><span>Ngày {Number(x.day)}</span><strong>{fmt(x.value)}</strong></div>
          )}
        </div>
      </div>

      <div className="card report-breakdown">
        <div className="section-title">Kết quả kinh doanh</div>
        <div className="summary-line"><span>Doanh thu trước giảm giá</span><strong>{fmt(grossSales)}</strong></div>
        <div className="summary-line"><span>Giảm giá</span><strong>-{fmt(discounts)}</strong></div>
        <div className="summary-line"><span>Doanh thu thực ghi nhận</span><strong>{fmt(revenue)}</strong></div>
        <div className="summary-line"><span>Giá vốn đã biết</span><strong>-{fmt(knownCost)}</strong></div>
        <div className="summary-line"><span>Chi phí vận hành đã nhập</span><strong>-{fmt(manualExpense)}</strong></div>
        <div className="summary-line total-report"><span>Lợi nhuận tạm tính</span><strong>{operatingProfit<0?'-':''}{fmt(Math.abs(operatingProfit))}</strong></div>
        <p className="hint">Phiếu nhập hàng đi vào dòng tiền, không trừ thẳng vào lợi nhuận vì hàng mua có thể vẫn còn tồn.</p>
      </div>

      <div className="card report-breakdown">
        <div className="section-title">Chi phí theo nhóm</div>
        {expenseList.length?expenseList.map(x=><div className="summary-line" key={x.name}><span>{x.name}</span><strong>{fmt(x.amount)}</strong></div>):<div className="empty">Chưa có khoản chi thủ công trong kỳ.</div>}
      </div>
    </>}

    {tab==='products'&&<div className="card report-table-card">
      <div className="section-title">Sản phẩm bán ra</div>
      {productRows.length?<div className="report-table">
        <div className="report-tr report-th"><span>Sản phẩm</span><span>SL</span><span>Doanh thu</span><span>Lãi gộp</span></div>
        {productRows.map(x=><div className="report-tr" key={x.name}><span>{x.name}</span><span>{x.qty}</span><span>{fmt(x.revenue)}</span><span>{fmt(x.profit)}</span></div>)}
      </div>:<div className="empty">Chưa có dữ liệu sản phẩm trong kỳ.</div>}
    </div>}

    {tab==='sources'&&<>
      <div className="card source-chart-card">
        <div className="chart-head">
          <div><div className="section-title">So sánh nguồn bán 6 tháng</div><p>Chiều cao thể hiện doanh thu theo từng nguồn bán</p></div>
        </div>
        <div className="source-month-grid">
          {recentMonths.map(ym=><div className="source-month" key={ym}>
            <div className="source-bars">
              {knownSources.map((s,idx)=>{
                const val=Number(sourceMonthData[s][ym]||0);
                return <div className={`source-bar source-${idx}`} key={s} title={`${s} · ${monthLabel(ym)}: ${fmt(val)}`} style={{height:`${Math.max(val?7:0,(val/maxSourceMonth)*100)}%`}}></div>
              })}
            </div>
            <small>{monthLabel(ym)}</small>
          </div>)}
        </div>
        <div className="source-legend">
          {knownSources.map((s,idx)=><span key={s}><i className={`legend-dot source-${idx}`}></i>{s}</span>)}
        </div>
      </div>

      <div className="card report-table-card">
        <div className="section-title">Nguồn bán trong kỳ đang xem</div>
        {sourceRows.length?<div className="report-table">
          <div className="report-tr report-th report-source"><span>Nguồn</span><span>Đơn</span><span>SL</span><span>Doanh thu</span></div>
          {sourceRows.map(x=><div className="report-tr report-source" key={x.name}><span>{x.name}</span><span>{x.orders}</span><span>{x.qty}</span><span>{fmt(x.revenue)}</span></div>)}
        </div>:<div className="empty">Chưa có dữ liệu nguồn bán trong kỳ.</div>}
      </div>
    </>}

    {tab==='cash'&&<>
      <div className="report-kpis colorful-kpis">
        <div className="card kpi-card kpi-green"><div className="muted">TIỀN VÀO</div><div className="money">{fmt(cashIn)}</div></div>
        <div className="card kpi-card kpi-red"><div className="muted">TIỀN RA</div><div className="money">{fmt(cashOut)}</div></div>
        <div className="card kpi-card kpi-blue"><div className="muted">MUA HÀNG</div><div className="money">{fmt(purchaseOut)}</div></div>
        <div className="card kpi-card kpi-orange"><div className="muted">CHÊNH LỆCH DÒNG TIỀN</div><div className={'money '+(cashNet<0?'negative':'')}>{cashNet<0?'-':''}{fmt(Math.abs(cashNet))}</div></div>
      </div>
      <div className="card report-breakdown">
        <div className="section-title">Dòng tiền</div>
        <div className="summary-line"><span>Tiền từ bán hàng</span><strong>+{fmt(revenue)}</strong></div>
        <div className="summary-line"><span>Thu khác</span><strong>+{fmt(otherIncome)}</strong></div>
        <div className="summary-line"><span>Mua nguyên liệu / bao bì</span><strong>-{fmt(purchaseOut)}</strong></div>
        <div className="summary-line"><span>Chi phí khác</span><strong>-{fmt(manualExpense)}</strong></div>
        <div className="summary-line total-report"><span>Chênh lệch dòng tiền</span><strong>{cashNet<0?'-':''}{fmt(Math.abs(cashNet))}</strong></div>
      </div>
    </>}
  </section>
}


function CloseDay({orders,receipts,transactions,closings,setClosings,back}){
  const [date,setDate]=useState(todayISO());
  const existing=(closings||[]).find(x=>x.date===date);
  const defaultChecks=['Kiểm tra ly / nắp','Kiểm tra trái cây','Kiểm tra topping','Bổ sung nguyên liệu','Chuẩn bị dụng cụ','Vệ sinh'];
  const [checks,setChecks]=useState(existing?.checks||defaultChecks.map(name=>({name,done:false})));
  const [note,setNote]=useState(existing?.note||'');
  const [actualCash,setActualCash]=useState(existing?.actualCash??'');
  const [actualBank,setActualBank]=useState(existing?.actualBank??'');

  useEffect(()=>{
    const found=(closings||[]).find(x=>x.date===date);
    setChecks(found?.checks||defaultChecks.map(name=>({name,done:false})));
    setNote(found?.note||'');
    setActualCash(found?.actualCash??'');
    setActualBank(found?.actualBank??'');
  },[date]);

  const dayOrders=(orders||[]).filter(o=>o.status!=='Đã hủy'&&o.date===date);
  const revenue=dayOrders.reduce((s,o)=>s+Number(o.total||0),0);
  const cash=dayOrders.filter(o=>o.payment==='Tiền mặt').reduce((s,o)=>s+Number(o.total||0),0);
  const bank=dayOrders.filter(o=>o.payment!=='Tiền mặt').reduce((s,o)=>s+Number(o.total||0),0);
  const qty=dayOrders.reduce((s,o)=>s+Number(o.totalQty||0),0);
  const dayReceiptOut=(receipts||[]).filter(r=>r.date===date).reduce((s,r)=>s+Number(r.total||0),0);
  const manualOut=(transactions||[]).filter(t=>t.date===date&&t.type==='Chi').reduce((s,t)=>s+Number(t.amount||0),0);
  const spend=dayReceiptOut+manualOut;

  function toggleCheck(i){setChecks(v=>v.map((x,idx)=>idx===i?{...x,done:!x.done}:x));}
  function save(){
    const record={date,revenue,cash,bank,qty,spend,checks,note,actualCash:actualCash===''?null:Number(actualCash),actualBank:actualBank===''?null:Number(actualBank),closedAt:new Date().toISOString()};
    setClosings(prev=>[record,...prev.filter(x=>x.date!==date)]);
    alert('Đã lưu chốt ngày.');
  }

  return <section className="screen close-day-screen">
    <div className="screen-head">
      <div><h2>Chốt ngày</h2><p>Kiểm tra doanh thu, tiền và việc chuẩn bị cho ngày mai</p></div>
      <button className="secondary small" onClick={back}>← Quay lại</button>
    </div>

    <label className="close-date">Ngày chốt<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>

    <div className="close-kpis">
      <div className="card"><div className="muted">DOANH THU</div><div className="money">{fmt(revenue)}</div><small>{dayOrders.length} đơn · {qty} sản phẩm</small></div>
      <div className="card"><div className="muted">TIỀN MẶT BÁN HÀNG</div><div className="money">{fmt(cash)}</div></div>
      <div className="card"><div className="muted">CHUYỂN KHOẢN / APP</div><div className="money">{fmt(bank)}</div></div>
      <div className="card"><div className="muted">CHI TRONG NGÀY</div><div className="money">{fmt(spend)}</div></div>
    </div>

    <div className="card close-reconcile">
      <div className="section-title">Đối chiếu cuối ngày</div>
      <div className="form-grid-2">
        <label>Tiền mặt thực tế<input type="number" value={actualCash} onChange={e=>setActualCash(e.target.value)} placeholder={String(cash)}/></label>
        <label>Chuyển khoản thực tế<input type="number" value={actualBank} onChange={e=>setActualBank(e.target.value)} placeholder={String(bank)}/></label>
      </div>
      {actualCash!==''&&<div className="summary-line"><span>Chênh tiền mặt</span><strong>{fmt(Number(actualCash)-cash)}</strong></div>}
      {actualBank!==''&&<div className="summary-line"><span>Chênh chuyển khoản</span><strong>{fmt(Number(actualBank)-bank)}</strong></div>}
    </div>

    <div className="card">
      <div className="section-title">Chuẩn bị ngày mai</div>
      <div className="close-checks">{checks.map((x,i)=><label className="check" key={x.name}><input type="checkbox" checked={x.done} onChange={()=>toggleCheck(i)}/><span>{x.name}</span></label>)}</div>
    </div>

    <div className="card">
      <label className="close-note">Ghi chú<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Ví dụ: Mai cần mua thêm ổi, ly 1L..."/></label>
    </div>

    <button className="primary full close-save" onClick={save}>{existing?'Cập nhật chốt ngày':'Chốt ngày'}</button>

    {(closings||[]).length>0&&<div className="card close-history">
      <div className="section-title">Lịch sử gần đây</div>
      {(closings||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,7).map(x=><button key={x.date} onClick={()=>setDate(x.date)}><span>{x.date}</span><strong>{fmt(x.revenue)}</strong></button>)}
    </div>}
  </section>
}


function More({go,user,onSignOut,syncState}){return <section className="screen"><h2>Thêm</h2><div className="card account-card"><div><div className="muted">TÀI KHOẢN</div><strong>Admin · Chủ quán</strong><small>{syncState==='saving'?'Đang đồng bộ dữ liệu…':syncState==='error'?'Có lỗi đồng bộ':'Dữ liệu đã đồng bộ'}</small></div><button className="secondary" onClick={onSignOut}>Đăng xuất</button></div><div className="report-menu"><button onClick={()=>go('foodapp')}>Nhập đơn từ App Food <span>›</span></button><button onClick={()=>go('products')}>Món & giá vốn <span>›</span></button><button onClick={()=>go('stock')}>Nguyên liệu & kho <span>›</span></button><button onClick={()=>go('closeDay')}>Chốt ngày <span>›</span></button><button>Cài đặt danh mục chi <span>›</span></button></div></section>}
