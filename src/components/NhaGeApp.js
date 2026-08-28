'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, supabaseReady } from '@/lib/supabase';

const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Number(n || 0)) + 'đ';
const VIETNAM_TZ = 'Asia/Ho_Chi_Minh';
const DEFAULT_PRODUCT_CATEGORIES = [];
const todayISO = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: VIETNAM_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date);
const vietnamTime = (date = new Date()) => new Intl.DateTimeFormat('vi-VN', {
  timeZone: VIETNAM_TZ, hour: '2-digit', minute: '2-digit', hour12: false
}).format(date);

export default function NhaGeApp() {
  const [user, setUser] = useState(null);
  const [role,setRole] = useState('admin');
  const [dataOwnerId,setDataOwnerId] = useState(null);
  const [shop,setShop] = useState(null);
  const [needsShopSetup,setNeedsShopSetup] = useState(false);
  const [memberInfo,setMemberInfo] = useState(null);
  const [pendingApprovals,setPendingApprovals] = useState([]);
  const [showApprovalNotice,setShowApprovalNotice] = useState(false);
  const [blockedStatus,setBlockedStatus] = useState(null);
  const approvalSeenRef = useRef(new Set());
  const [authLoading, setAuthLoading] = useState(true);
  const [dataReady, setDataReady] = useState(false);
  const [syncState, setSyncState] = useState('idle');
  const [syncError, setSyncError] = useState('');
  const [screen, setScreen] = useState('order');
  const [orderTab, setOrderTab] = useState('new');
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [productCategories,setProductCategories] = useState(DEFAULT_PRODUCT_CATEGORIES);
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
  const [currentDate,setCurrentDate] = useState(todayISO());




  // Tự chuyển sang ngày mới theo giờ Việt Nam, kể cả khi app được mở xuyên đêm.
  useEffect(() => {
    const refreshDate = () => setCurrentDate(todayISO());
    refreshDate();
    const timer = setInterval(refreshDate, 30000);
    const onVisible = () => { if (document.visibilityState === 'visible') refreshDate(); };
    const onFocus = () => refreshDate();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    if (!supabaseReady || !supabase) { setAuthLoading(false); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) { setUser(data.session?.user || null); setAuthLoading(false); }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      if (!session?.user) { setRole('admin'); setDataOwnerId(null); setShop(null); setNeedsShopSetup(false); setMemberInfo(null); setDataReady(false); setOrders([]); setProducts([]); setProductCategories(DEFAULT_PRODUCT_CATEGORIES); setIngredients([]); setStockReceipts([]); setStockCounts([]); setStockAdjustments([]); setCashTransactions([]); setExpenseCategories(defaultExpenseCategories); setOpeningBalances({cash:0,bank:0}); setDayClosings([]); }
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!user || !supabase) return;
    let alive = true;
    setDataReady(false); setNeedsShopSetup(false); setSyncState('saving'); setSyncError('');
    (async () => {
      // 1) Nếu là nhân viên: tìm membership theo user hiện tại.
      const { data: membership, error: memberError } = await supabase
        .from('shop_members')
        .select('shop_id,owner_user_id,username,display_name,role,active')
        .eq('member_user_id', user.id)
        .maybeSingle();

      if (!alive) return;
      if (memberError) { setSyncState('error'); setSyncError(memberError.message); return; }

      if (membership && membership.active === false) {
        await supabase.auth.signOut();
        alert('Tài khoản nhân viên đang bị khóa.');
        return;
      }

      let activeShop = null;
      let resolvedRole = 'admin';
      let ownerId = user.id;

      if (membership?.shop_id) {
        const {data:s,error:sError}=await supabase
          .from('shops')
          .select('id,code,name,phone,address,plan,status,owner_user_id,created_at')
          .eq('id',membership.shop_id)
          .maybeSingle();
        if (sError) { setSyncState('error'); setSyncError(sError.message); return; }
        activeShop = s;
        resolvedRole = membership.role || 'employee';
        ownerId = membership.owner_user_id || s?.owner_user_id;
      } else {
        // 2) Chủ quán: tìm quán thuộc chính tài khoản này.
        const {data:s,error:sError}=await supabase
          .from('shops')
          .select('id,code,name,phone,address,plan,status,owner_user_id,created_at')
          .eq('owner_user_id',user.id)
          .maybeSingle();
        if (sError) { setSyncState('error'); setSyncError(sError.message); return; }
        activeShop = s;
      }

      if (!alive) return;

      // User mới đăng ký nhưng chưa tạo quán.
      if (!activeShop) {
        setRole('admin');
        setDataOwnerId(user.id);
        setShop(null);
        setMemberInfo(null);
        setNeedsShopSetup(true);
        setSyncState('saved');
        return;
      }

      const blockedMap={
        pending:'pending',
        rejected:'rejected',
        suspended:'suspended',
        locked:'locked',
        inactive:'suspended'
      };
      if (blockedMap[activeShop.status]) {
        setBlockedStatus(blockedMap[activeShop.status]);
        await supabase.auth.signOut();
        return;
      }
      setBlockedStatus(null);

      setShop(activeShop);
      setDataOwnerId(ownerId);
      setRole(resolvedRole);
      setMemberInfo(membership || null);
      setScreen(resolvedRole === 'admin' ? 'home' : 'order');

      // Dữ liệu giờ thuộc shop_id, không còn phụ thuộc vào thiết bị/tài khoản đang mở.
      const { data, error } = await supabase
        .from('app_states')
        .select('products,product_categories,orders,ingredients,stock_receipts,stock_counts,stock_adjustments,cash_transactions,expense_categories,opening_balances,day_closings')
        .eq('shop_id', activeShop.id)
        .maybeSingle();

      if (!alive) return;
      if (error) { setSyncState('error'); setSyncError(error.message); return; }

      if (!data) {
        setSyncState('error');
        setSyncError('Quán chưa có vùng dữ liệu. Hãy chạy migration v0.20.');
        return;
      }

      // SaaS: quán mới phải bắt đầu sạch. Không tự chèn menu/nguyên liệu Nhà Gé.
      const loadedProducts=Array.isArray(data.products) ? data.products : [];
      setProducts(loadedProducts);
      const savedCats=Array.isArray(data.product_categories)?data.product_categories.filter(Boolean):[];
      const productCats=loadedProducts.map(p=>p.category).filter(Boolean);
      setProductCategories(savedCats.length?Array.from(new Set(savedCats)):Array.from(new Set(productCats)));
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setIngredients(Array.isArray(data.ingredients) ? data.ingredients : []);
      setStockReceipts(Array.isArray(data.stock_receipts) ? data.stock_receipts : []);
      setStockCounts(Array.isArray(data.stock_counts) ? data.stock_counts : []);
      setStockAdjustments(Array.isArray(data.stock_adjustments) ? data.stock_adjustments : []);
      setCashTransactions(Array.isArray(data.cash_transactions) ? data.cash_transactions : []);
      setExpenseCategories(Array.isArray(data.expense_categories) && data.expense_categories.length ? data.expense_categories : defaultExpenseCategories);
      setOpeningBalances(data.opening_balances && typeof data.opening_balances==='object' ? data.opening_balances : {cash:0,bank:0});
      setDayClosings(Array.isArray(data.day_closings) ? data.day_closings : []);

      setDataReady(true); setSyncState('saved');
    })();

    return () => { alive = false; };
  }, [user?.id]);
  useEffect(()=>{if(!user||!supabase||!dataReady||!shop?.id)return;let stopped=false;async function ping(){if(stopped)return;try{await supabase.rpc('record_app_activity',{p_shop_id:shop.id});}catch{}}ping();const timer=setInterval(ping,5*60*1000);return()=>{stopped=true;clearInterval(timer);};},[user?.id,shop?.id,dataReady]);

  useEffect(() => {
    if (!user || !supabase || !dataReady || !shop?.id) return;
    setSyncState('saving');
    const timer = setTimeout(async () => {
      const payload = {
        products,
        product_categories:productCategories,
        stock_receipts:stockReceipts,
        stock_counts:stockCounts,
        cash_transactions:cashTransactions,
        expense_categories:expenseCategories,
        opening_balances:openingBalances,
        day_closings:dayClosings,
        updated_at:new Date().toISOString()
      };

      let error = null;

      const result = await supabase.from('app_states').update(payload).eq('shop_id', shop.id);
      error = result.error;

      if (error) { setSyncState('error'); setSyncError(error.message); }
      else { setSyncState('saved'); setSyncError(''); }
    }, 500);
    return () => clearTimeout(timer);
  }, [products, productCategories, stockReceipts, stockCounts, cashTransactions, expenseCategories, openingBalances, dayClosings, role, user?.id, shop?.id, dataReady]);

  const dayOrders = useMemo(() => orders.filter(o => o.date === currentDate && o.status !== 'Đã hủy'), [orders, currentDate]);
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
  function buildStockMovements(items, direction) {
    const movements = [];
    (items || []).forEach(item => {
      const product = products.find(p => p.id === item.productId);
      (product?.recipe || []).forEach(r => {
        const qty = Number(r.qty || 0) * Number(item.qty || 0) * direction;
        if (!qty) return;
        movements.push({ ingredientId:r.ingredientId, qty, productId:item.productId, productName:item.name });
      });
    });
    return movements;
  }

  function makeStockAdjustments(movements, refId, reason, date = todayISO()) {
    const now = Date.now();
    return (movements || []).map((m,i)=>({
      id:`TK-${now}-${i}`,
      date,
      ingredientId:m.ingredientId,
      qty:Number(m.qty||0),
      reason,
      refId,
      note:m.productName||''
    }));
  }

  async function saveOrderAtomic(order, action='append', deltas=[], adjustments=[]) {
    if (!supabase || !shop?.id) return {ok:false};
    setSyncState('saving');
    const {data,error} = await supabase.rpc('save_order_atomic_v2', {
      p_shop_id:shop.id,
      p_order:order,
      p_action:action,
      p_deltas:deltas,
      p_adjustments:adjustments
    });
    if (error) {
      setSyncState('error');
      setSyncError(error.message);
      alert('Không lưu được đơn: ' + error.message);
      return {ok:false,error};
    }
    if (data) {
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setIngredients(Array.isArray(data.ingredients) ? data.ingredients : []);
      setStockAdjustments(Array.isArray(data.stock_adjustments) ? data.stock_adjustments : []);
    }
    setSyncState('saved');
    setSyncError('');
    return {ok:true,data};
  }

  async function refreshSharedOrders() {
    if (!supabase || !shop?.id) return;
    const {data,error} = await supabase
      .from('app_states')
      .select('orders,ingredients,stock_adjustments')
      .eq('shop_id',shop.id)
      .maybeSingle();
    if (!error && data) {
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setIngredients(Array.isArray(data.ingredients) ? data.ingredients : []);
      setStockAdjustments(Array.isArray(data.stock_adjustments) ? data.stock_adjustments : []);
      setSyncState('saved');
      setSyncError('');
    }
  }

  // Nhận đơn mới từ thiết bị khác và tự tải lại khi quay lại tab.
  useEffect(() => {
    if (!supabase || !dataReady || !shop?.id) return;
    refreshSharedOrders();
    const channel = supabase
      .channel(`app-state-${shop.id}`)
      .on('postgres_changes', {
        event:'UPDATE',
        schema:'public',
        table:'app_states',
        filter:`shop_id=eq.${shop.id}`
      }, () => refreshSharedOrders())
      .subscribe();

    const onFocus = () => refreshSharedOrders();
    const onVisible = () => { if (document.visibilityState === 'visible') refreshSharedOrders(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [shop?.id, dataReady]);


  async function audit(action,detail=''){if(!supabase||!shop?.id)return;try{await supabase.rpc('record_audit_log',{p_shop_id:shop.id,p_action:action,p_detail:String(detail||'')});}catch{}}

  async function completeOrder() {
    if (!cart.length) return alert('Chưa có món trong đơn.');
    const subtotal = cart.reduce((s, x) => s + x.price * x.qty, 0);
    const discountValue = Math.max(0, Math.min(Number(discount || 0), subtotal));
    const total = subtotal - discountValue;
    const totalQty = cart.reduce((s, x) => s + x.qty, 0);
    const now = new Date();
    const items = cart.map(x=>({productId:x.id,name:x.name,qty:x.qty,price:x.price,cost:x.cost||0}));
    const id = `DH-${Date.now()}`;
    const stockMovements = buildStockMovements(items, -1);
    const orderDate = todayISO(now);
    const order = {
      id, date:orderDate, time:vietnamTime(now), source:'Tại quán', payment, status:'Hoàn tất',
      items, stockMovements, totalQty, subtotal, discount:discountValue, total, note:''
    };
    const adjustments = makeStockAdjustments(stockMovements,id,'Bán hàng',orderDate);
    const result = await saveOrderAtomic(order,'append',stockMovements,adjustments);
    if (!result.ok) return;
    audit('Tạo đơn',`${order.id} · ${fmt(order.total)}`);
    setCart([]); setDiscount(''); setOrderTab('list');
  }

  async function saveFoodOrder(e) {
    e.preventDefault();
    if (!foodCart.length) return alert('Vui lòng chọn ít nhất 1 món đã bán trên App Food.');
    if (!foodForm.total) return alert('Vui lòng nhập doanh thu thực nhận.');
    const items = foodCart.map(x=>({productId:x.id,name:x.name,qty:x.qty,price:x.price,cost:x.cost||0}));
    const totalQty = items.reduce((s,x)=>s+Number(x.qty||0),0);
    const id = `APP-${Date.now()}`;
    const stockMovements = buildStockMovements(items, -1);
    const order = {
      id, date:foodForm.date,
      time:vietnamTime(new Date()),
      source:foodForm.app, payment:'App Food', status:'Hoàn tất',
      items, stockMovements, totalQty,
      subtotal:Number(foodForm.total), discount:0, total:Number(foodForm.total),
      note:foodForm.note||'Nhập tổng cuối ngày'
    };
    const adjustments = makeStockAdjustments(stockMovements,id,'Bán hàng App Food',foodForm.date);
    const result = await saveOrderAtomic(order,'append',stockMovements,adjustments);
    if (!result.ok) return;
    setFoodForm({ date:todayISO(), app:'Grab Food', total:'', note:'' });
    setFoodCart([]);
    setScreen('order'); setOrderTab('list');
  }

  async function cancelOrder(id) {
    const order = orders.find(o=>o.id===id);
    if (!order || order.status==='Đã hủy') return;
    const restored = (order.stockMovements||[]).map(m=>({
      ...m,
      qty:-Number(m.qty||0)
    }));
    const now=Date.now();
    const adjustments = restored.map((m,i)=>({
      id:`HK-${now}-${i}`,
      date:todayISO(),
      ingredientId:m.ingredientId,
      qty:Number(m.qty||0),
      reason:'Hoàn kho do hủy đơn',
      refId:id,
      note:m.productName||''
    }));
    const updated = {...order,status:'Đã hủy'};
    const result = await saveOrderAtomic(updated,'replace',restored,adjustments);
    if (result.ok){ audit('Hủy đơn',id); setSelectedOrder(null); }
  }

  async function saveOrderEdit(updated) {
    const result = await saveOrderAtomic(updated,'replace',[],[]);
    if (result.ok) setSelectedOrder(null);
  }

  async function signOut(){ if (supabase) await supabase.auth.signOut(); }

  useEffect(()=>{
    if(!user || !isSaasAdminUser(user) || !supabase) return;
    let alive=true;

    async function loadPending(showPopup=true){
      try{
        const {data:{session}}=await supabase.auth.getSession();
        const res=await fetch('/api/admin/saas?action=overview',{
          headers:{'Authorization':`Bearer ${session?.access_token||''}`}
        });
        const body=await res.json().catch(()=>({}));
        if(!res.ok || !alive)return;

        const pending=(body.shops||[]).filter(s=>s.status==='pending');
        setPendingApprovals(pending);

        const unseen=pending.filter(s=>!approvalSeenRef.current.has(s.id));
        if(showPopup && unseen.length){
          unseen.forEach(s=>approvalSeenRef.current.add(s.id));
          setShowApprovalNotice(true);
        }
      }catch{}
    }

    loadPending(true);
    const timer=setInterval(()=>loadPending(true),15000);
    const onFocus=()=>loadPending(true);
    window.addEventListener('focus',onFocus);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadPending(true)});

    return ()=>{
      alive=false;
      clearInterval(timer);
      window.removeEventListener('focus',onFocus);
    };
  },[user?.id]);


  if (authLoading) return <LoadingScreen text="Đang kiểm tra tài khoản…" />;
  if (!supabaseReady) return <SetupScreen />;


  if (blockedStatus) return <BlockedShopScreen status={blockedStatus} onBack={()=>setBlockedStatus(null)} />;
  if (!user) return <AuthScreen />;
  if (needsShopSetup) return <CreateShopScreen user={user} onCreated={()=>window.location.reload()} onSignOut={signOut} />;
  if (!dataReady && syncState !== 'error') return <LoadingScreen text="Đang tải dữ liệu quán…" />;
  if (syncState === 'error' && !dataReady) return <SyncErrorScreen message={syncError} />;

  return <div className="app-shell">
    <header className="topbar"><div><div className="brand">{shop?.name||'QUẢN LÝ QUÁN'}</div><div className="date">Free Beta · Bản 0.25 · <span className={'sync '+syncState}>{syncState==='saving'?'Đang đồng bộ…':syncState==='error'?'Lỗi đồng bộ':'Đã đồng bộ'}</span></div></div><button className="icon-btn settings-btn admin-settings-wrap" aria-label="Cài đặt" title="Cài đặt" onClick={() => setScreen('more')}>⚙{isSaasAdminUser(user)&&pendingApprovals.length>0&&<span className="admin-pending-badge">{pendingApprovals.length}</span>}</button></header>
    <main>
      <div className="page-transition" key={screen}>
      {role==='admin' && screen === 'home' && <Home todayRevenue={todayRevenue} dayOrders={dayOrders} todayQty={todayQty} cashToday={cashToday} bankToday={bankToday} knownCostToday={knownCostToday} ingredients={ingredients} closings={dayClosings} go={setScreen} openOrders={() => {setScreen('order');setOrderTab('list')}} />}
      {screen === 'order' && <OrdersScreen products={products.filter(p=>p.active!==false)} tab={orderTab} setTab={setOrderTab} cart={cart} addProduct={addProduct} changeQty={changeQty} payment={payment} setPayment={setPayment} discount={discount} setDiscount={setDiscount} completeOrder={completeOrder} orders={orders} openOrder={setSelectedOrder} goFood={() => role==='admin' && setScreen('foodapp')} />}
      {role==='admin' && screen === 'foodapp' && <FoodAppForm form={foodForm} setForm={setFoodForm} products={products.filter(p=>p.active!==false)} cart={foodCart} addProduct={addFoodProduct} changeQty={changeFoodQty} onSubmit={saveFoodOrder} back={() => {setScreen('order');setOrderTab('list')}} />}
      {role==='admin' && screen === 'products' && <ProductManager products={products} setProducts={setProducts} productCategories={productCategories} setProductCategories={setProductCategories} ingredients={ingredients} audit={audit} back={()=>setScreen('more')} />}
      {role==='admin' && screen === 'stock' && <Stock audit={audit} ingredients={ingredients} setIngredients={setIngredients} receipts={stockReceipts} setReceipts={setStockReceipts} counts={stockCounts} setCounts={setStockCounts} adjustments={stockAdjustments} setAdjustments={setStockAdjustments} products={products} setProducts={setProducts} />}
      {role==='admin' && screen === 'cash' && <Cash orders={orders} receipts={stockReceipts} transactions={cashTransactions} setTransactions={setCashTransactions} categories={expenseCategories} setCategories={setExpenseCategories} openingBalances={openingBalances} setOpeningBalances={setOpeningBalances} />}
      {role==='admin' && screen === 'reports' && <Reports orders={orders} products={products} receipts={stockReceipts} transactions={cashTransactions} openOrder={setSelectedOrder} />}
      {role==='admin' && screen === 'closeDay' && <CloseDay orders={orders} receipts={stockReceipts} transactions={cashTransactions} closings={dayClosings} setClosings={setDayClosings} back={()=>setScreen('home')} />}
      {role==='admin' && screen === 'employees' && <EmployeeAccounts user={user} shop={shop} back={()=>setScreen('more')} />}
      {role==='admin' && screen === 'shopSetup' && <ShopSetup shop={shop} products={products} ingredients={ingredients} openingBalances={openingBalances} go={setScreen} back={()=>setScreen('more')} />}
      {role==='admin' && screen === 'auditLog' && <AuditLog shop={shop} back={()=>setScreen('more')} />}
      {role==='admin' && screen === 'shopSettings' && <ShopSettings shop={shop} setShop={setShop} user={user} back={()=>setScreen('more')} />}
      {role==='admin' && isSaasAdminUser(user) && screen === 'saasAdmin' && <SaasAdminDashboard user={user} back={()=>setScreen('more')} />}
      {screen === 'more' && <More role={role} memberInfo={memberInfo} shop={shop} go={setScreen} user={user} onSignOut={signOut} syncState={syncState} pendingCount={pendingApprovals.length} />}
      {user?.user_metadata?.force_password_change&&<ForcePasswordChange />}
      {isSaasAdminUser(user)&&showApprovalNotice&&pendingApprovals.length>0&&<div className="approval-notice-backdrop">
        <div className="approval-notice-card">
          <div className="approval-notice-icon">🔔</div>
          <div>
            <div className="saas-admin-kicker">ĐĂNG KÝ MỚI</div>
            <h3>{pendingApprovals.length} quán đang chờ xét duyệt</h3>
            <p>{pendingApprovals[0]?.name||'Quán mới'} · {displayOwnerPhone(pendingApprovals[0]?.owner_phone||'')||'Chưa có SĐT'}{pendingApprovals[0]?.business_type?` · ${pendingApprovals[0].business_type}`:''}</p>
          </div>
          <div className="approval-notice-actions">
            <button className="secondary" onClick={()=>setShowApprovalNotice(false)}>Để sau</button>
            <button className="primary" onClick={()=>{setShowApprovalNotice(false);setScreen('saasAdmin')}}>Xem & xét duyệt</button>
          </div>
        </div>
      </div>}
      </div>
    </main>
    <nav className={'bottom-nav '+(role!=='admin'?'employee-nav':'')}>
      {role==='admin'?<>
        <Nav active={screen==='stock'} icon="▦" label="Kho" onClick={()=>setScreen('stock')} />
        <Nav active={screen==='order'} icon="＋" label="Order" onClick={()=>setScreen('order')} />
        <Nav active={screen==='home'} icon="⌂" label="Trang chủ" onClick={()=>setScreen('home')} />
        <Nav active={screen==='cash'} icon="₫" label="Thu chi" onClick={()=>setScreen('cash')} />
        <Nav active={screen==='reports'} icon="▤" label="Báo cáo" onClick={()=>setScreen('reports')} />
      </>:<>
        <Nav active={screen==='order'} icon="＋" label="Order" onClick={()=>setScreen('order')} />
        <Nav active={screen==='more'} icon="☰" label="Tài khoản" onClick={()=>setScreen('more')} />
      </>}
    </nav>
    {selectedOrder && <OrderDrawer order={selectedOrder} onClose={()=>setSelectedOrder(null)} onCancel={role==='admin'?cancelOrder:null} onSave={role==='admin'?saveOrderEdit:null} readOnly={role!=='admin'} />}
  </div>;
}

function normalizeOwnerPhone(value=''){
  let digits=String(value).replace(/\D/g,'');
  if(digits.startsWith('0')) digits='84'+digits.slice(1);
  else if(!digits.startsWith('84') && digits.length===9) digits='84'+digits;
  return digits;
}
function ownerPhoneLoginEmail(value=''){
  const phone=normalizeOwnerPhone(value);
  return phone ? `p${phone}@users.quanlyquan.local` : '';
}
function displayOwnerPhone(value=''){
  const phone=normalizeOwnerPhone(value);
  return phone.startsWith('84') ? '0'+phone.slice(2) : phone;
}

function isSaasAdminUser(user){
  return String(user?.email||'').toLowerCase()==='admin@tiemnhage.local'
    || user?.user_metadata?.saas_admin===true;
}


function BlockedShopScreen({status,onBack}){
  const config={
    pending:{
      icon:'⏳',
      title:'Đang chờ xét duyệt',
      text:'Đăng ký của bạn đã được ghi nhận và đang chờ Admin xét duyệt.'
    },
    rejected:{
      icon:'!',
      title:'Quán không được duyệt',
      text:'Đăng ký này chưa được Admin chấp thuận. Nếu cần kiểm tra lại, hãy liên hệ Admin.'
    },
    suspended:{
      icon:'Ⅱ',
      title:'Quán đang tạm ngưng',
      text:'Quán đang bị tạm ngưng sử dụng. Vui lòng liên hệ Admin để được hỗ trợ.'
    },
    locked:{
      icon:'🔒',
      title:'Quán đã bị khóa',
      text:'Tài khoản/quán đã bị khóa do trạng thái quản trị. Vui lòng liên hệ Admin để được hỗ trợ.'
    }
  };
  const c=config[status]||config.locked;
  return <div className="auth-shell"><div className="auth-card blocked-shop-card">
    <div className={`blocked-icon ${status}`}>{c.icon}</div>
    <h1>{c.title}</h1>
    <p>{c.text}</p>
    {(status==='locked'||status==='suspended'||status==='rejected')&&
      <a className="zalo-support-btn" href="https://zalo.me/0332995337" target="_blank" rel="noreferrer">Nhắn Admin qua Zalo</a>
    }
    <button className="secondary full" onClick={onBack}>Về màn đăng nhập</button>
  </div></div>
}

function AuthScreen(){
  const [mode,setMode]=useState('owner');
  const [ownerMode,setOwnerMode]=useState('login');
  const [phone,setPhone]=useState('');
  const [email,setEmail]=useState('');
  const [shopName,setShopName]=useState('');
  const [shopAddress,setShopAddress]=useState('');
  const [menuPreset,setMenuPreset]=useState('cafe');
  const [username,setUsername]=useState('');
  const [shopCode,setShopCode]=useState('');
  const [password,setPassword]=useState('');
  const [showPassword,setShowPassword]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [messageOk,setMessageOk]=useState(false);
  const [loginStatus,setLoginStatus]=useState('');

  function validPhone(){
    const p=normalizeOwnerPhone(phone);
    return /^84\d{9}$/.test(p);
  }

  async function loginOwner(e){
    e.preventDefault(); setBusy(true); setMessage(''); setMessageOk(false); setLoginStatus('');
    const raw=String(phone||'').trim();

    // Giữ tương thích tài khoản Admin cũ của Nhà Gé.
    if(raw.toLowerCase()==='admin'){
      const {error}=await supabase.auth.signInWithPassword({email:'admin@tiemnhage.local',password});
      if(error)setMessage('Sai tài khoản hoặc mật khẩu.');
      setBusy(false);
      return;
    }

    if(!validPhone()){
      setBusy(false); setMessage('Số điện thoại chưa đúng. Ví dụ: 0901234567'); return;
    }

    try{
      const res=await fetch('/api/auth/login',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({phone:normalizeOwnerPhone(phone),password})
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok){
        setBusy(false);
        if(data.status==='pending'){setLoginStatus('pending');setMessage('Đăng ký thành công. Tài khoản đang chờ Admin xét duyệt.');}
        else if(data.status==='rejected'){setLoginStatus('rejected');setMessage('Quán của bạn không được duyệt. Vui lòng liên hệ Admin nếu cần hỗ trợ.');}
        else if(data.status==='suspended'){setLoginStatus('suspended');setMessage('Quán đang tạm ngưng. Vui lòng liên hệ Admin.');}
        else if(data.status==='locked'){setLoginStatus('locked');setMessage('Tài khoản đã bị khóa. Vui lòng liên hệ Admin.');}
        else setMessage(data.error||'Sai số điện thoại hoặc mật khẩu.');
        return;
      }
      const {error}=await supabase.auth.setSession({
        access_token:data.access_token,
        refresh_token:data.refresh_token
      });
      if(error)setMessage('Không mở được phiên đăng nhập. Vui lòng thử lại.');
    }catch(err){
      setMessage('Không kết nối được máy chủ. Vui lòng thử lại.');
    }
    setBusy(false);
  }

  async function loginEmployee(e){
    e.preventDefault(); setBusy(true); setMessage(''); setMessageOk(false);
    const u=username.trim().toLowerCase();
    const code=shopCode.trim().toLowerCase().replace(/\s+/g,'');
    let error=null;

    if(code){
      const primary=`${code}.${u}@staff.quanlyquan.local`;
      ({error}=await supabase.auth.signInWithPassword({email:primary,password}));
    }

    // Tài khoản nhân viên tạo trước v0.20 vẫn đăng nhập được.
    if(!code || error){
      const legacy=`${u}@tiemnhage.local`;
      const legacyResult=await supabase.auth.signInWithPassword({email:legacy,password});
      error=legacyResult.error;
    }

    if(error) setMessage('Sai mã quán, tên đăng nhập hoặc mật khẩu.');
    setBusy(false);
  }

  async function signup(e){
    e.preventDefault(); setBusy(true); setMessage(''); setMessageOk(false);

    if(!validPhone()){
      setBusy(false); setMessage('Số điện thoại chưa đúng. Ví dụ: 0901234567'); return;
    }
    if(email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){
      setBusy(false); setMessage('Email chưa đúng định dạng hoặc để trống nếu không dùng.'); return;
    }
    if(password.length<6){
      setBusy(false); setMessage('Mật khẩu cần ít nhất 6 ký tự.'); return;
    }
    if(!shopName.trim()){
      setBusy(false); setMessage('Vui lòng nhập tên quán.'); return;
    }

    try{
      const res=await fetch('/api/auth/register',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          phone:normalizeOwnerPhone(phone),
          email:email.trim().toLowerCase()||null,
          password,
          shopName:shopName.trim(),
          shopAddress:shopAddress.trim()||null,
          menuPreset
        })
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok){
        setBusy(false);
        setMessage(data.error||'Không tạo được tài khoản.');
        return;
      }

      setBusy(false);
      setMessageOk(true);
      setMessage('Đăng ký thành công. Tài khoản đang chờ Admin xét duyệt. Sau khi được duyệt, bạn đăng nhập để tạo quán.');
    }catch(err){
      setBusy(false); setMessage('Không kết nối được máy chủ. Vui lòng thử lại.');
    }
  }

  return <div className="auth-shell"><div className="auth-card saas-auth">
    <div className="auth-logo">Q</div>
    <h1>Quản lý quán</h1>
    <p>Free Beta · Mỗi quán có vùng dữ liệu riêng.</p>

    <div className="auth-tabs">
      <button className={mode==='owner'?'active':''} onClick={()=>{setMode('owner');setMessage('')}}>Chủ quán</button>
      <button className={mode==='employee'?'active':''} onClick={()=>{setMode('employee');setMessage('')}}>Nhân viên</button>
    </div>

    {mode==='owner'&&<>
      <div className="auth-subtabs">
        <button className={ownerMode==='login'?'active':''} onClick={()=>{setOwnerMode('login');setMessage('')}}>Đăng nhập</button>
        <button className={ownerMode==='signup'?'active':''} onClick={()=>{setOwnerMode('signup');setMessage('')}}>Đăng ký miễn phí</button>
      </div>

      <form className="auth-form" onSubmit={ownerMode==='signup'?signup:loginOwner}>
        <label>Số điện thoại
          <input
            required
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={e=>setPhone(e.target.value)}
            placeholder={ownerMode==='login'?'0901 234 567':'0901 234 567'}
          />
        </label>

        {ownerMode==='signup'&&<>
          <label>Email <span className="optional">không bắt buộc</span>
            <input
              type="email"
              value={email}
              onChange={e=>setEmail(e.target.value)}
              autoCapitalize="none"
              autoComplete="email"
              placeholder="ban@quan.com"
            />
          </label>

          <label>Tên quán
            <input required value={shopName} onChange={e=>setShopName(e.target.value)} placeholder="Ví dụ: Mây Coffee"/>
          </label>

          <label>Địa chỉ <span className="optional">không bắt buộc</span>
            <input value={shopAddress} onChange={e=>setShopAddress(e.target.value)} placeholder="Địa chỉ quán"/>
          </label>

          <div className="signup-menu-block">
            <div className="starter-title">
              <strong>Loại hình & menu khởi đầu</strong>
              <small>Admin sẽ nhìn thấy lựa chọn này trước khi xét duyệt.</small>
            </div>
            <div className="signup-menu-grid">
              {Object.entries(STARTER_MENUS).filter(([key])=>key!=='empty').map(([key,p])=>
                <button type="button" key={key} className={'signup-menu-option '+(menuPreset===key?'selected':'')} onClick={()=>setMenuPreset(key)}>
                  <span>{p.icon}</span>
                  <div><strong>{p.label}</strong><small>{p.products.length} món mẫu</small></div>
                  <i>{menuPreset===key?'✓':''}</i>
                </button>
              )}
            </div>
          </div>
        </>}

        <label>Mật khẩu
          <div className="password-field">
            <input type={showPassword?'text':'password'} required minLength={6} value={password} onChange={e=>setPassword(e.target.value)} />
            <button type="button" className="password-eye" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?'Ẩn mật khẩu':'Xem mật khẩu'}>{showPassword?'◉':'◌'}</button>
          </div>
        </label>

        {message&&<div className={'auth-message '+(messageOk?'ok':'')}>{message}</div>}
        {['rejected','suspended','locked'].includes(loginStatus)&&<a className="zalo-support-btn compact" href="https://zalo.me/0332995337" target="_blank" rel="noreferrer">Liên hệ Admin qua Zalo</a>}
        <button className="primary full" disabled={busy}>
          {busy?'Đang xử lý…':ownerMode==='signup'?'Tạo tài khoản Free':'Đăng nhập'}
        </button>
        {ownerMode==='login'&&<a className="forgot-zalo" href="https://zalo.me/0332995337" target="_blank" rel="noreferrer">Quên mật khẩu? Nhắn Admin qua Zalo</a>}
      </form>

      {ownerMode==='signup'&&
        <p className="hint">Sau khi gửi đăng ký, Admin sẽ xem thông tin quán và xét duyệt. Khi được duyệt, bạn đăng nhập bằng SĐT để vào quán ngay.</p>
      }
    </>}

    {mode==='employee'&&<form className="auth-form" onSubmit={loginEmployee}>
      <label>Mã quán <input value={shopCode} onChange={e=>setShopCode(e.target.value.toUpperCase())} autoCapitalize="characters" placeholder="Ví dụ: A1B2C3"/></label>
      <label>Tên đăng nhập<input required value={username} onChange={e=>setUsername(e.target.value)} autoCapitalize="none" /></label>
      <label>Mật khẩu<div className="password-field"><input type={showPassword?'text':'password'} required value={password} onChange={e=>setPassword(e.target.value)} /><button type="button" className="password-eye" onClick={()=>setShowPassword(v=>!v)}>{showPassword?'◉':'◌'}</button></div></label>
      {message&&<div className="auth-message">{message}</div>}
      <button className="primary full" disabled={busy}>{busy?'Đang đăng nhập…':'Đăng nhập nhân viên'}</button>
      <p className="hint">Tài khoản nhân viên cũ của Nhà Gé có thể để trống Mã quán.</p>
    </form>}
  </div></div>
}

const STARTER_MENUS = {
  empty: {label:'Quán trống',icon:'＋',desc:'Tự thêm menu của bạn sau.',products:[]},
  cafe: {
    label:'Cà phê & nước',icon:'☕',desc:'Khung menu gần với Tiệm Nhà Gé: cà phê, trà, matcha, cacao.',
    products:[
      ['Cà phê','Cà phê đen',15000],['Cà phê','Cà phê sữa',18000],['Cà phê','Cà phê muối',25000],
      ['Cà phê','Bạc xỉu',27000],['Cà phê','Cà phê kem dẻo',30000],['Cà phê','Sữa tươi cà phê',25000],
      ['Trà trái cây','Trà chanh',22000],['Trà trái cây','Trà tắc',22000],['Trà trái cây','Hồng trà',27000],
      ['Trà trái cây','Trà ổi',27000],['Trà trái cây','Trà mãng cầu chanh dây',30000],['Trà trái cây','Trà trái cây tươi 1L',39000],
      ['Matcha','Matcha Latte',28000],['Matcha','Matcha Oatside',28000],['Matcha','Matcha Kem Muối',32000],
      ['Matcha','Matcha Hạnh Nhân',30000],['Matcha','Matcha Cold Whisk',32000],['Matcha','Matcha Latte Yakult',32000],
      ['Ca cao','Ca cao sữa',28000],['Ca cao','Ca cao kem muối',32000],
      ['Trà sữa','Trà sữa truyền thống',30000],['Trà sữa','Sữa tươi trân châu đường đen',32000],
      ['Nước ép','Nước ép dưa hấu',32000],['Nước ép','Nước ép thơm',35000],
      ['Ăn vặt','Tô trái cây',25000],['Ăn vặt','Bánh tráng',20000]
    ]
  },
  fruit: {
    label:'Trái cây cắt sẵn',icon:'🍉',desc:'Trái cây phần, tô mix, combo và nước ép cơ bản.',
    products:[
      ['Trái cây phần','Dưa hấu cắt sẵn',25000],['Trái cây phần','Thơm cắt sẵn',25000],['Trái cây phần','Ổi cắt sẵn',25000],
      ['Trái cây phần','Xoài cắt sẵn',30000],['Trái cây phần','Cóc cắt sẵn',25000],['Trái cây phần','Thanh long cắt sẵn',30000],
      ['Trái cây mix','Tô trái cây mix nhỏ',35000],['Trái cây mix','Tô trái cây mix lớn',50000],
      ['Trái cây mix','Combo trái cây 2 người',69000],['Trái cây mix','Combo trái cây gia đình',119000],
      ['Ăn kèm','Muối tôm',5000],['Ăn kèm','Muối ớt',5000],['Ăn kèm','Sốt chấm trái cây',7000],
      ['Nước ép','Nước ép dưa hấu',30000],['Nước ép','Nước ép thơm',35000],['Nước ép','Nước ép cam',35000],
      ['Nước ép','Nước ép cà rốt',30000]
    ]
  },
  noodles: {
    label:'Bún / Phở',icon:'🍜',desc:'Khung món chính, món thêm và nước uống cho quán bún/phở.',
    products:[
      ['Phở','Phở bò tái',45000],['Phở','Phở bò chín',45000],['Phở','Phở tái nạm',50000],['Phở','Phở đặc biệt',60000],
      ['Bún','Bún bò',45000],['Bún','Bún bò đặc biệt',55000],['Bún','Bún thịt nướng',45000],['Bún','Bún chả giò',40000],
      ['Món thêm','Thêm thịt',20000],['Món thêm','Thêm bò viên',15000],['Món thêm','Thêm chả',10000],
      ['Món thêm','Thêm bún/phở',10000],['Món thêm','Quẩy',5000],
      ['Nước uống','Trà đá',3000],['Nước uống','Nước suối',10000],['Nước uống','Nước ngọt',15000]
    ]
  },
  rice: {
    label:'Quán cơm',icon:'🍚',desc:'Cơm phần phổ biến, món thêm, canh và nước uống.',
    products:[
      ['Cơm phần','Cơm sườn',40000],['Cơm phần','Cơm sườn bì',45000],['Cơm phần','Cơm sườn bì chả',50000],
      ['Cơm phần','Cơm gà chiên',40000],['Cơm phần','Cơm gà xối mỡ',45000],['Cơm phần','Cơm thịt kho trứng',40000],
      ['Cơm phần','Cơm cá kho',40000],['Cơm phần','Cơm bò xào',50000],['Cơm phần','Cơm phần đặc biệt',55000],
      ['Món thêm','Thêm cơm',7000],['Món thêm','Thêm trứng ốp la',8000],['Món thêm','Thêm sườn',25000],
      ['Món thêm','Thêm chả',10000],['Món thêm','Canh thêm',7000],
      ['Nước uống','Trà đá',3000],['Nước uống','Nước suối',10000],['Nước uống','Nước ngọt',15000]
    ]
  }
};

function starterProducts(key){
  const rows=STARTER_MENUS[key]?.products||[];
  return rows.map((row,i)=>({
    id:`starter-${key}-${i+1}`,
    category:row[0],
    name:row[1],
    price:row[2],
    cost:0,
    active:true,
    recipe:[]
  }));
}

function CreateShopScreen({user,onCreated,onSignOut}){
  const [form,setForm]=useState({name:'',phone:'',address:''});
  const [menuPreset,setMenuPreset]=useState('empty');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  async function submit(e){
    e.preventDefault();
    if(!form.name.trim())return;
    setBusy(true); setMessage('');
    const {data,error}=await supabase.rpc('create_my_shop',{
      p_name:form.name.trim(),
      p_phone:form.phone.trim()||null,
      p_address:form.address.trim()||null
    });
    if(error){setBusy(false);setMessage(error.message);return;}

    const shopId=data?.id;
    const products=starterProducts(menuPreset);
    if(shopId && products.length){
      const presetCategories=Array.from(new Set(products.map(p=>p.category).filter(Boolean)));
      const {error:menuError}=await supabase
        .from('app_states')
        .update({products,product_categories:presetCategories,updated_at:new Date().toISOString()})
        .eq('shop_id',shopId);
      if(menuError){
        setBusy(false);
        setMessage('Đã tạo quán nhưng chưa nạp được menu mẫu: '+menuError.message);
        return;
      }
    }
    setBusy(false);
    onCreated(data);
  }

  return <div className="auth-shell setup-shell"><div className="auth-card create-shop-card setup-card">
    <div className="auth-logo">Q</div>
    <div className="free-pill">FREE BETA</div>
    <h1>Tạo quán của bạn</h1>
    <p>Chọn sẵn một bộ menu để vào app là có thể chỉnh sửa và bắt đầu bán ngay.</p>

    <form className="auth-form" onSubmit={submit}>
      <label>Tên quán<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ví dụ: Mây Coffee"/></label>
      <label>Số điện thoại quán <span className="optional">không bắt buộc</span><input inputMode="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="09xx xxx xxx"/></label>
      <label>Địa chỉ <span className="optional">không bắt buộc</span><input value={form.address} onChange={e=>setForm({...form,address:e.target.value})} placeholder="Địa chỉ quán"/></label>

      <div className="starter-menu-block">
        <div className="starter-title"><strong>Chọn bộ menu khởi đầu</strong><small>Có thể sửa tên, giá hoặc xóa món sau khi tạo quán.</small></div>
        <div className="starter-grid">
          {Object.entries(STARTER_MENUS).map(([key,p])=><button type="button" key={key} className={'starter-option '+(menuPreset===key?'selected':'')} onClick={()=>setMenuPreset(key)}>
            <span className="starter-icon">{p.icon}</span>
            <span><strong>{p.label}</strong><small>{p.desc}</small>{p.products.length>0&&<em>{p.products.length} món mẫu</em>}</span>
            <i>{menuPreset===key?'✓':''}</i>
          </button>)}
        </div>
      </div>

      {message&&<div className="auth-message">{message}</div>}
      <button className="primary full setup-submit" disabled={busy}>{busy?'Đang tạo quán…':'Tạo quán & bắt đầu sử dụng'}</button>
    </form>
    <button className="auth-link-btn" onClick={onSignOut}>Đăng xuất tài khoản này</button>
  </div></div>
}
function LoadingScreen({text}){ return <div className="auth-shell"><div className="auth-card center"><div className="spinner"></div><strong>{text}</strong></div></div> }
function SetupScreen(){ return <div className="auth-shell"><div className="auth-card"><h1>Chưa kết nối dữ liệu</h1><p>Bản 0.25 cần thêm thông tin kết nối Supabase trên Vercel trước khi đăng nhập được.</p><div className="auth-message">Cần 2 biến: NEXT_PUBLIC_SUPABASE_URL và NEXT_PUBLIC_SUPABASE_ANON_KEY.</div></div></div> }
function SyncErrorScreen({message}){ return <div className="auth-shell"><div className="auth-card"><h1>Chưa tải được dữ liệu</h1><p>Hãy kiểm tra đã chạy file <b>supabase.sql</b> trong Supabase chưa.</p><div className="auth-message">{message}</div></div></div> }

function Nav({active,icon,label,onClick}) { return <button className={'nav-item '+(active?'active':'')} onClick={onClick}><span>{icon}</span><small>{label}</small></button> }

function Home({todayRevenue,dayOrders,todayQty,cashToday,bankToday,knownCostToday,ingredients,closings,go,openOrders}) {
  const lowStock = (ingredients||[]).filter(x => Number(x.minQty||0)>0 && Number(x.qty||0)<=Number(x.minQty||0));
  const closedToday=(closings||[]).some(x=>x.date===todayISO());
  return <section className="screen">
    {lowStock.length>0&&<div className="card stock-alert-card warning priority-stock-alert">
      <div className="stock-alert-head"><div><div className="section-title">⚠ Cảnh báo tồn kho cần xử lý</div><p>{lowStock.length} mục đang ở mức cần bổ sung.</p></div><button className="secondary" onClick={()=>go('stock')}>Xử lý ngay</button></div>
      <div className="home-stock-alerts">{lowStock.slice(0,5).map(x=><div className="home-stock-row" key={x.id}><span>⚠ {x.name}</span><strong>{x.qty} {x.unit}</strong></div>)}{lowStock.length>5&&<div className="hint">Còn {lowStock.length-5} mục khác đang cảnh báo.</div>}</div>
    </div>}
    <div className="card hero"><div className="muted">DOANH THU HÔM NAY</div><div className="big-number">{fmt(todayRevenue)}</div><div className="stats-row"><div><strong>{dayOrders.length}</strong><span>đơn</span></div><div><strong>{todayQty}</strong><span>ly / sản phẩm</span></div></div></div>
    <div className="grid-2"><div className="card"><div className="muted">TIỀN MẶT</div><div className="money">{fmt(cashToday)}</div></div><div className="card"><div className="muted">CHUYỂN KHOẢN</div><div className="money">{fmt(bankToday)}</div></div></div>
    <div className="card"><div className="section-title">Lợi nhuận tạm tính</div><div className="profit">{fmt(Math.max(todayRevenue-knownCostToday,0))}</div><div className="summary-line"><span>Doanh thu</span><strong>{fmt(todayRevenue)}</strong></div><div className="summary-line"><span>Giá vốn đã biết</span><strong>-{fmt(knownCostToday)}</strong></div></div>
    {!lowStock.length&&<div className="card stock-alert-card ok"><div className="stock-alert-head"><div><div className="section-title">Cảnh báo tồn kho</div><p>Kho hiện chưa có mục nào dưới mức cảnh báo.</p></div><button className="secondary" onClick={()=>go('stock')}>Xem kho</button></div></div>}
    <div className="quick-actions"><button onClick={openOrders}>Danh sách đơn</button><button onClick={()=>go('foodapp')}>Nhập đơn App Food</button><button onClick={()=>go('closeDay')}>{closedToday?'✓ Đã chốt ngày':'Chốt ngày'}</button></div>
  </section>
}

function OrdersScreen({products,tab,setTab,cart,addProduct,changeQty,payment,setPayment,discount,setDiscount,completeOrder,orders,openOrder,goFood}) {
  const [query,setQuery] = useState('');
  const [source,setSource] = useState('Tất cả');
  const [category,setCategory] = useState('Tất cả');
  const [dateMode,setDateMode] = useState('all');
  const [dateFrom,setDateFrom] = useState(todayISO());
  const [dateTo,setDateTo] = useState(todayISO());

  const categories = ['Tất cả', ...Array.from(new Set(products.map(p=>p.category).filter(Boolean)))];
  const shownProducts = products
    .filter(p=>category==='Tất cả'||p.category===category)
    .filter(p=>p.name.toLowerCase().includes(query.toLowerCase()));

  const filteredOrders = orders.filter(o => {
    const sourceOk = source==='Tất cả'||o.source===source;
    const q = query.trim().toLowerCase();
    const queryOk = !q
      || String(o.id||'').toLowerCase().includes(q)
      || String(o.source||'').toLowerCase().includes(q)
      || (o.items||[]).some(x=>String(x.name||'').toLowerCase().includes(q));

    let dateOk = true;
    if(dateMode==='day') dateOk = String(o.date||'')===dateFrom;
    if(dateMode==='range') dateOk = String(o.date||'')>=dateFrom && String(o.date||'')<=dateTo;
    return sourceOk && queryOk && dateOk;
  });

  const subtotal = cart.reduce((s,x)=>s+x.price*x.qty,0);
  const discountValue = Math.max(0, Math.min(Number(discount || 0), subtotal));
  const total = subtotal - discountValue;

  return <section className="screen">
    <div className="segmented"><button className={tab==='new'?'active':''} onClick={()=>setTab('new')}>Tạo đơn</button><button className={tab==='list'?'active':''} onClick={()=>setTab('list')}>Danh sách đơn</button></div>

    {tab==='new' ? <>
      <div className="search-row"><input placeholder="Tìm món..." value={query} onChange={e=>setQuery(e.target.value)} /></div>
      <div className="chips">{categories.map(c=><button key={c} className={'chip '+(category===c?'active':'')} onClick={()=>setCategory(c)}>{c}</button>)}</div>
      <div className="products">{shownProducts.map(p=>{const selected=cart.find(x=>x.id===p.id);return <button className={'product '+(selected?'selected':'')} key={p.id} onClick={()=>addProduct(p)}><span>{p.name}</span><strong>{fmt(p.price)}</strong>{selected&&<em className="selected-badge">×{selected.qty}</em>}</button>})}</div>
      <div className="card order-card">
        <div className="section-title">Đơn hiện tại</div>
        {!cart.length?<div className="empty">Chưa có món</div>:cart.map(x=><div className="cart-row" key={x.id}><div><strong>{x.name}</strong><small>{fmt(x.price)}</small></div><div className="qty"><button onClick={()=>changeQty(x.id,-1)}>−</button><span>{x.qty}</span><button onClick={()=>changeQty(x.id,1)}>+</button></div></div>)}
        <div className="discount-box"><label>Giảm giá<input type="number" min="0" max={subtotal} value={discount} onChange={e=>setDiscount(e.target.value)} placeholder="0" /></label></div>
        {discountValue>0&&<div className="summary-line"><span>Tạm tính</span><strong>{fmt(subtotal)}</strong></div>}
        <div className="summary-line total"><span>Khách thanh toán</span><strong>{fmt(total)}</strong></div>
        <div className="payment-grid">{['Tiền mặt','Chuyển khoản'].map(x=><button key={x} className={'pay '+(payment===x?'active':'')} onClick={()=>setPayment(x)}>{x}</button>)}</div>
        <button className="primary full" onClick={completeOrder}>Hoàn tất đơn</button>
      </div>
    </> : <>
      <div className="list-tools">
        <input placeholder="Tìm mã đơn / món / nguồn bán" value={query} onChange={e=>setQuery(e.target.value)} />
        <select value={source} onChange={e=>setSource(e.target.value)}>
          <option>Tất cả</option><option>Tại quán</option><option>Grab Food</option><option>Shopee Food</option><option>Green Food</option><option>Be Food</option><option>Khác</option>
        </select>
      </div>

      <div className="card order-date-filter">
        <div className="order-filter-head">
          <strong>Thời gian xem đơn</strong>
          <small>{filteredOrders.length} đơn</small>
        </div>
        <div className="segmented order-date-mode">
          <button className={dateMode==='all'?'active':''} onClick={()=>setDateMode('all')}>Tất cả</button>
          <button className={dateMode==='day'?'active':''} onClick={()=>setDateMode('day')}>Theo ngày</button>
          <button className={dateMode==='range'?'active':''} onClick={()=>setDateMode('range')}>Khoảng ngày</button>
        </div>
        {dateMode==='day'&&<label className="compact-date-input">Ngày<input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label>}
        {dateMode==='range'&&<div className="date-range-grid">
          <label>Từ ngày<input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label>
          <label>Đến ngày<input type="date" value={dateTo} min={dateFrom} onChange={e=>setDateTo(e.target.value)}/></label>
        </div>}
      </div>

      <button className="primary full" onClick={goFood}>+ Nhập đơn từ App Food</button>
      <div className="orders-list">
        {filteredOrders.length
          ? filteredOrders.map(o=><button className="order-row" key={o.id} onClick={()=>openOrder(o)}><div><strong>{o.source}</strong><small>{o.date} · {o.time} · {o.totalQty} ly / sản phẩm</small><span className={'status '+(o.status==='Đã hủy'?'cancel':'')}>{o.status}</span></div><div className="order-money"><strong>{fmt(o.total)}</strong><small>{o.payment}{Number(o.discount||0)>0?` · Giảm ${fmt(o.discount)}`:''}</small><span>›</span></div></button>)
          : <div className="card empty">Không có đơn trong khoảng thời gian này.</div>}
      </div>
    </>}
  </section>
}

function ProductManager({products,setProducts,productCategories,setProductCategories,ingredients,audit,back}) {
  const categories=Array.from(new Set((productCategories||[]).filter(Boolean)));
  const empty = {id:null,name:'',category:categories[0]||'',price:'',cost:'',active:true,recipe:[]};
  const [form,setForm] = useState(empty);
  const [editing,setEditing] = useState(false);
  const [recipeProduct,setRecipeProduct]=useState(null);
  const [bulkMode,setBulkMode]=useState(false);
  const [bulkRows,setBulkRows]=useState([]);
  const [bulkSearch,setBulkSearch]=useState('');
  const [showCategories,setShowCategories]=useState(false);
  const [newCategory,setNewCategory]=useState('');
  const [stockSetMode,setStockSetMode]=useState(false);
  const [stockIngredientId,setStockIngredientId]=useState('');
  const [stockSelected,setStockSelected]=useState([]);
  const [stockQtyByProduct,setStockQtyByProduct]=useState({});
  const [stockSearch,setStockSearch]=useState('');

  useEffect(()=>{
    if(!form.category && categories.length) setForm(v=>({...v,category:categories[0]}));
  },[categories.join('|')]);

  async function importMenuFile(file){
    if(!file)return;
    try{
      const XLSX=await import('xlsx');
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
      const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
      const pick=(row,names)=>{const key=Object.keys(row).find(k=>names.some(n=>norm(k).includes(n)));return key?row[key]:'';};
      const imported=rows.map((r,i)=>({id:`IMP-${Date.now()}-${i}`,name:String(pick(r,['ten mon','name'])).trim(),category:String(pick(r,['danh muc','category'])||'Khác').trim(),price:Number(String(pick(r,['gia ban','price'])||0).replace(/[^0-9.-]/g,'')),cost:Number(String(pick(r,['gia von','cost'])||0).replace(/[^0-9.-]/g,'')),active:true,recipe:[]})).filter(x=>x.name&&Number.isFinite(x.price));
      if(!imported.length)throw new Error('Không đọc được món. File cần cột: Tên món, Danh mục, Giá bán, Giá vốn.');
      if(!confirm(`Đọc được ${imported.length} món. Nhập vào menu?`))return;
      setProducts(prev=>[...prev,...imported]);setProductCategories(prev=>Array.from(new Set([...prev,...imported.map(x=>x.category).filter(Boolean)])));alert(`Đã import ${imported.length} món.`);
    }catch(e){alert(e.message||'Không đọc được file Excel.');}
  }
  function submit(e){
    e.preventDefault();
    if(!form.name||!form.price) return alert('Vui lòng nhập tên món và giá bán.');
    if(!form.category)return alert('Vui lòng tạo/chọn danh mục món.');
    const item={...form,id:form.id||`p-${Date.now()}`,price:Number(form.price),cost:Number(form.cost||0),category:form.category,recipe:form.recipe||[]};
    setProducts(prev=>editing?prev.map(p=>p.id===item.id?item:p):[...prev,item]); audit?.(editing?'Sửa món':'Thêm món',item.name);
    setForm({...empty,category:form.category}); setEditing(false);
  }
  function edit(p){setForm({...p,recipe:p.recipe||[]});setEditing(true);window.scrollTo({top:0,behavior:'smooth'});}
  function toggle(id){setProducts(prev=>prev.map(p=>p.id===id?{...p,active:p.active===false?true:false}:p));}
  function saveRecipe(recipe){setProducts(prev=>prev.map(p=>p.id===recipeProduct.id?{...p,recipe}:p));setRecipeProduct(null);}

  function addCategory(){
    const value=newCategory.trim();
    if(!value)return;
    if(categories.some(c=>c.toLowerCase()===value.toLowerCase()))return alert('Danh mục này đã tồn tại.');
    setProductCategories(prev=>[...prev,value]);
    setNewCategory('');
    if(!form.category)setForm(v=>({...v,category:value}));
  }
  function renameCategory(cat){
    const next=prompt('Tên danh mục mới:',cat)?.trim();
    if(!next||next===cat)return;
    if(categories.some(c=>c!==cat&&c.toLowerCase()===next.toLowerCase()))return alert('Tên danh mục này đã tồn tại.');
    setProductCategories(prev=>prev.map(c=>c===cat?next:c));
    setProducts(prev=>prev.map(p=>p.category===cat?{...p,category:next}:p));
    setForm(v=>v.category===cat?{...v,category:next}:v);
  }
  function removeCategory(cat){
    const used=products.filter(p=>p.category===cat).length;
    if(used)return alert(`Danh mục "${cat}" đang có ${used} món. Hãy chuyển các món sang danh mục khác trước khi xóa.`);
    if(!confirm(`Xóa danh mục "${cat}"?`))return;
    setProductCategories(prev=>prev.filter(x=>x!==cat));
    setForm(v=>v.category===cat?{...v,category:categories.find(x=>x!==cat)||''}:v);
  }

  function openBulk(){
    setBulkRows(products.map(p=>({
      id:p.id,name:p.name,category:p.category||'',
      price:String(Number(p.price||0)),cost:String(Number(p.cost||0))
    })));
    setBulkSearch('');
    setBulkMode(true);
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function changeBulk(id,key,value){setBulkRows(rows=>rows.map(r=>r.id===id?{...r,[key]:value}:r));}
  function dirtyCount(){
    const byId=new Map(products.map(p=>[p.id,p]));
    return bulkRows.filter(r=>{
      const p=byId.get(r.id);
      return p&&(Number(r.price||0)!==Number(p.price||0)||Number(r.cost||0)!==Number(p.cost||0));
    }).length;
  }
  function saveBulk(){
    const invalid=bulkRows.find(r=>r.price===''||Number(r.price)<0||r.cost===''||Number(r.cost)<0);
    if(invalid)return alert(`Kiểm tra lại giá của món: ${invalid.name}`);
    const edits=new Map(bulkRows.map(r=>[r.id,{price:Number(r.price||0),cost:Number(r.cost||0)}]));
    setProducts(prev=>prev.map(p=>edits.has(p.id)?{...p,...edits.get(p.id)}:p));
    setBulkMode(false);setBulkSearch('');
  }

  function loadIngredientAssignments(ingredientId){
    const qtyMap={};
    const selected=[];
    products.forEach(p=>{
      const assigned=(p.recipe||[]).find(r=>r.ingredientId===ingredientId);
      if(assigned){
        qtyMap[p.id]=String(assigned.qty??'');
        selected.push(p.id);
      }
    });
    setStockQtyByProduct(qtyMap);
    setStockSelected(selected);
  }
  function openStockSet(){
    const firstId=ingredients[0]?.id||'';
    setStockSetMode(true);
    setStockIngredientId(firstId);
    setStockSearch('');
    loadIngredientAssignments(firstId);
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function changeStockIngredient(id){
    setStockIngredientId(id);
    loadIngredientAssignments(id);
  }
  function toggleStockProduct(id){
    setStockSelected(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  }
  function setStockQtyFor(id,value){
    setStockQtyByProduct(prev=>({...prev,[id]:value}));
  }
  function selectAllShown(ids){
    const allSelected=ids.length>0&&ids.every(id=>stockSelected.includes(id));
    setStockSelected(prev=>allSelected?prev.filter(id=>!ids.includes(id)):Array.from(new Set([...prev,...ids])));
  }
  function saveStockSet(){
    if(!stockIngredientId)return alert('Vui lòng chọn nguyên liệu.');
    if(!stockSelected.length)return alert('Hãy tích chọn ít nhất 1 món.');
    const invalid=stockSelected.find(id=>!(Number(stockQtyByProduct[id])>0));
    if(invalid){
      const p=products.find(x=>x.id===invalid);
      return alert(`Nhập số lượng trừ cho món "${p?.name||''}".`);
    }
    setProducts(prev=>prev.map(p=>{
      const recipe=Array.isArray(p.recipe)?p.recipe:[];
      const hadIngredient=recipe.some(r=>r.ingredientId===stockIngredientId);

      if(stockSelected.includes(p.id)){
        const qty=Number(stockQtyByProduct[p.id]);
        const next=hadIngredient
          ?recipe.map(r=>r.ingredientId===stockIngredientId?{...r,qty}:r)
          :[...recipe,{ingredientId:stockIngredientId,qty}];
        return {...p,recipe:next};
      }

      if(hadIngredient){
        return {...p,recipe:recipe.filter(r=>r.ingredientId!==stockIngredientId)};
      }
      return p;
    }));
    const ing=ingredients.find(x=>x.id===stockIngredientId);
    alert(`Đã lưu set ${ing?.name||'nguyên liệu'} cho ${stockSelected.length} món.`);
    loadIngredientAssignments(stockIngredientId);
  }

  if(stockSetMode){
    const ing=ingredients.find(x=>x.id===stockIngredientId);
    const q=stockSearch.trim().toLowerCase();
    const shown=products.filter(p=>!q||p.name.toLowerCase().includes(q)||String(p.category||'').toLowerCase().includes(q));
    const shownIds=shown.map(p=>p.id);
    return <section className="screen product-stock-set-screen">
      <div className="screen-head product-bulk-head">
        <div>
          <button className="back" onClick={()=>setStockSetMode(false)}>← Món & giá vốn</button>
          <h2>Set trừ kho</h2>
          <p>Chọn nguyên liệu. Bên dưới tích món cần gán và nhập lượng trừ riêng cho từng món.</p>
        </div>
        <button className="secondary small" onClick={()=>setStockSetMode(false)}>Đóng</button>
      </div>

      {!ingredients.length&&<div className="card auth-message">Kho chưa có nguyên liệu. Hãy tạo nguyên liệu trong mục Kho trước.</div>}
      {!!ingredients.length&&<>
        <div className="card stock-set-config single">
          <label>Nguyên liệu
            <select value={stockIngredientId} onChange={e=>changeStockIngredient(e.target.value)}>
              {ingredients.map(x=><option key={x.id} value={x.id}>{x.name} · {x.unit}</option>)}
            </select>
          </label>
          <div className="stock-set-tip">Số lượng ở từng món bên dưới sẽ được hiểu theo đơn vị <b>{ing?.unit||'—'}</b> của nguyên liệu này.</div>
        </div>

        <div className="card stock-set-toolbar">
          <input value={stockSearch} onChange={e=>setStockSearch(e.target.value)} placeholder="Tìm món hoặc danh mục…"/>
          <button className="secondary" onClick={()=>selectAllShown(shownIds)}>{shownIds.length&&shownIds.every(id=>stockSelected.includes(id))?'Bỏ chọn tất cả':'Chọn tất cả'}</button>
        </div>

        <div className="card stock-set-products">
          <div className="stock-set-summary"><strong>{stockSelected.length} món đã chọn</strong><span>{shown.length}/{products.length} món đang hiển thị</span></div>
          {shown.map(p=>{
            const assigned=(p.recipe||[]).find(r=>r.ingredientId===stockIngredientId);
            const checked=stockSelected.includes(p.id);
            return <div className={'stock-set-product-row '+(checked?'selected':'')} key={p.id}>
              <label className="stock-set-check">
                <input type="checkbox" checked={checked} onChange={()=>toggleStockProduct(p.id)}/>
                <div><strong>{p.name}</strong><small>{p.category}{assigned?` · Đang set: ${assigned.qty} ${ing?.unit||''}`:''}</small></div>
              </label>
              <label className="stock-row-qty">
                <span>SL trừ</span>
                <div><input type="number" min="0" step="0.01" inputMode="decimal" value={stockQtyByProduct[p.id]??''} onChange={e=>setStockQtyFor(p.id,e.target.value)} placeholder="0"/><b>{ing?.unit||''}</b></div>
              </label>
            </div>
          })}
        </div>

        <div className="bulk-save-bar">
          <div><strong>{stockSelected.length} món được gán</strong><small>{ing?.name||'Chọn nguyên liệu'} · mỗi món dùng lượng trừ riêng</small></div>
          <button className="primary" onClick={saveStockSet} disabled={!stockSelected.length}>Lưu set trừ kho</button>
        </div>
      </>}
    </section>
  }

  if(bulkMode){
    const q=bulkSearch.trim().toLowerCase();
    const shown=bulkRows.filter(r=>!q||r.name.toLowerCase().includes(q)||r.category.toLowerCase().includes(q));
    const changed=dirtyCount();
    return <section className="screen product-bulk-screen">
      <div className="screen-head product-bulk-head">
        <div>
          <button className="back" onClick={()=>setBulkMode(false)}>← Món & giá vốn</button>
          <h2>Sửa giá hàng loạt</h2>
          <p>Nhập lại giá bán và giá vốn. Chỉ khi bấm <b>Lưu tất cả</b> dữ liệu mới được cập nhật.</p>
        </div>
        <div className="bulk-head-actions">
          <span className={changed?'bulk-change-count active':'bulk-change-count'}>{changed} món thay đổi</span>
          <button className="secondary small" onClick={()=>setBulkMode(false)}>Hủy</button>
        </div>
      </div>
      <div className="card bulk-toolbar"><input value={bulkSearch} onChange={e=>setBulkSearch(e.target.value)} placeholder="Tìm tên món hoặc danh mục…"/><span>{shown.length}/{bulkRows.length} món</span></div>
      <div className="card bulk-price-card">
        <div className="bulk-price-row bulk-price-table-head"><span>Món</span><span>Giá bán</span><span>Giá vốn</span></div>
        {shown.map(r=><div className="bulk-price-row" key={r.id}>
          <div className="bulk-product-name"><strong>{r.name}</strong><small>{r.category}</small></div>
          <label><span>Giá bán</span><input type="number" inputMode="numeric" min="0" step="1000" value={r.price} onChange={e=>changeBulk(r.id,'price',e.target.value)}/></label>
          <label><span>Giá vốn</span><input type="number" inputMode="numeric" min="0" step="100" value={r.cost} onChange={e=>changeBulk(r.id,'cost',e.target.value)}/></label>
        </div>)}
      </div>
      <div className="bulk-save-bar"><div><strong>{changed} món đã chỉnh</strong><small>Các món chưa thay đổi sẽ được giữ nguyên.</small></div><button className="primary" onClick={saveBulk} disabled={!changed}>Lưu tất cả</button></div>
    </section>
  }

  return <section className="screen">
    <button className="back" onClick={back}>← Quay lại</button>
    <div className="screen-head product-manager-head">
      <div><h2>Món & giá vốn</h2><p className="hint">Quản lý danh mục, giá bán, giá vốn và cách trừ kho của menu.</p></div>
      <div className="product-manager-actions"><label className="bulk-edit-entry import-menu-entry"><span>⇧</span><div><strong>Import menu Excel/CSV</strong><small>Tên món · Danh mục · Giá bán · Giá vốn</small></div><input type="file" accept=".xlsx,.xls,.csv" hidden onChange={e=>{importMenuFile(e.target.files?.[0]);e.target.value='';}}/></label>
        <button className="bulk-edit-entry stock-set-entry" onClick={openStockSet}><span>▦</span><div><strong>Set trừ kho</strong><small>{ingredients.length} nguyên liệu</small></div></button>
        <button className="bulk-edit-entry" onClick={openBulk}><span>✎</span><div><strong>Sửa giá hàng loạt</strong><small>{products.length} sản phẩm</small></div></button>
      </div>
    </div>

    <div className="card category-manager-card">
      <div className="category-manager-head">
        <div><strong>Danh mục món</strong><small>Danh mục được lấy theo đúng menu của quán. Có thể thêm, sửa hoặc xóa.</small></div>
        <button className="secondary small" onClick={()=>setShowCategories(v=>!v)}>{showCategories?'Thu gọn':'Quản lý danh mục'}</button>
      </div>
      {!categories.length&&<div className="empty compact">Chưa có danh mục. Hãy tạo danh mục đầu tiên.</div>}
      <div className="category-chip-list">{categories.map(c=><span key={c}>{c}</span>)}</div>
      {showCategories&&<div className="category-manager-body">
        <div className="category-add-row"><input value={newCategory} onChange={e=>setNewCategory(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addCategory();}}} placeholder="Tên danh mục mới"/><button className="primary" type="button" onClick={addCategory}>+ Thêm</button></div>
        <div className="category-delete-list">{categories.map(c=><div key={c}><span>{c}</span><div className="category-crud-actions"><button type="button" onClick={()=>renameCategory(c)}>Sửa</button><button type="button" className="danger" onClick={()=>removeCategory(c)}>Xóa</button></div></div>)}</div>
      </div>}
    </div>

    <form className="form-card" onSubmit={submit}>
      <label>Tên món<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ví dụ: Trà Ổi" /></label>
      <label>Danh mục
        <select value={form.category||''} onChange={e=>setForm({...form,category:e.target.value})}>
          <option value="">Chọn danh mục</option>
          {categories.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <div className="form-grid-2">
        <label>Giá bán<input type="number" value={form.price} onChange={e=>setForm({...form,price:e.target.value})} /></label>
        <label>Giá vốn<input type="number" value={form.cost} onChange={e=>setForm({...form,cost:e.target.value})} placeholder="Có thể nhập sau" /></label>
      </div>
      <button className="primary full">{editing?'Lưu thay đổi':'+ Thêm món'}</button>
      {editing&&<button type="button" className="secondary full" onClick={()=>{setForm({...empty,category:categories[0]||''});setEditing(false)}}>Bỏ chỉnh sửa</button>}
    </form>

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
        <div className="products">{shown.map(p=>{const selected=cart.find(x=>x.id===p.id);return <button type="button" className={'product '+(selected?'selected':'')} key={p.id} onClick={()=>addProduct(p)}><span>{p.name}</span><strong>{fmt(p.price)}</strong>{selected&&<em className="selected-badge">×{selected.qty}</em>}</button>})}</div>
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

function OrderDrawer({order,onClose,onCancel,onSave,readOnly=false}) {
  const [draft,setDraft]=useState({...order, subtotal:Number(order.subtotal ?? order.total ?? 0), discount:Number(order.discount || 0)});
  const draftSubtotal = Number(draft.subtotal ?? draft.total ?? 0);
  const draftDiscount = Math.max(0, Math.min(Number(draft.discount || 0), draftSubtotal));
  const draftTotal = draftSubtotal - draftDiscount;
  function save(){ onSave({...draft, discount:draftDiscount, total:draftTotal}); }
  return <div className="overlay" onClick={onClose}><aside className="drawer" onClick={e=>e.stopPropagation()}><div className="drawer-head"><div><small>MÃ ĐƠN</small><strong>{order.id}</strong></div><button onClick={onClose}>×</button></div><div className="detail-grid"><div><small>Ngày bán</small><strong>{draft.date}</strong></div><div><small>Nguồn</small><strong>{draft.source}</strong></div><label><small>Số ly / sản phẩm</small><input type="number" value={draft.totalQty} readOnly={readOnly} onChange={e=>setDraft({...draft,totalQty:Number(e.target.value)})}/></label><label><small>Tạm tính</small><input type="number" value={draftSubtotal} readOnly={readOnly} onChange={e=>setDraft({...draft,subtotal:Number(e.target.value)})}/></label><label><small>Giảm giá</small><input type="number" min="0" value={draft.discount||0} readOnly={readOnly} onChange={e=>setDraft({...draft,discount:Number(e.target.value)})}/></label><div><small>Khách thanh toán</small><strong>{fmt(draftTotal)}</strong></div></div>{draft.items?.length>0&&<div className="card flat"><div className="section-title">Chi tiết món</div>{draft.items.map((x,i)=><div className="summary-line" key={i}><span>{x.name} × {x.qty}</span><strong>{fmt(x.price*x.qty)}</strong></div>)}</div>}<label className="drawer-note"><small>Ghi chú</small><textarea value={draft.note||''} onChange={e=>setDraft({...draft,note:e.target.value})}/></label><button className="primary full" onClick={save}>Lưu chỉnh sửa</button>{order.status!=='Đã hủy'&&<button className="danger full" onClick={()=>onCancel(order.id)}>Hủy đơn</button>}</aside></div> }

function Stock({audit,ingredients,setIngredients,receipts,setReceipts,counts,setCounts,adjustments,setAdjustments,products=[],setProducts}){
  const [tab,setTab]=useState('inventory'); const [modal,setModal]=useState(null);
  const [ingForm,setIngForm]=useState({id:null,name:'',type:'Nguyên liệu',unit:'g',qty:'',minQty:'',purchasePrice:''});
  const [receipt,setReceipt]=useState({date:todayISO(),ingredientId:'',qty:'',unitPrice:'',total:'',payment:'Chuyển khoản'});
  const [count,setCount]=useState({date:todayISO(),ingredientId:'',actual:'',note:''});
  const [adjust,setAdjust]=useState({date:todayISO(),ingredientId:'',qty:'',reason:'Hư hao',note:''});
  const ingMap=Object.fromEntries(ingredients.map(x=>[x.id,x]));
  function saveIngredient(e){e.preventDefault(); if(!ingForm.name.trim())return; const item={...ingForm,id:ingForm.id||`NL-${Date.now()}`,qty:Number(ingForm.qty||0),minQty:Number(ingForm.minQty||0),purchasePrice:Number(ingForm.purchasePrice||0)}; setIngredients(v=>ingForm.id?v.map(x=>x.id===item.id?item:x):[...v,item]);setIngForm({id:null,name:'',type:'Nguyên liệu',unit:'g',qty:'',minQty:'',purchasePrice:''});setModal(null);}
  function deleteIngredient(){
    if(!ingForm.id)return;
    const usedBy=(products||[]).filter(p=>(p.recipe||[]).some(r=>r.ingredientId===ingForm.id));
    const extra=usedBy.length?`\nNguyên liệu này đang nằm trong công thức của ${usedBy.length} món. Hệ thống sẽ gỡ nguyên liệu khỏi các công thức đó.`:'';
    if(!confirm(`Xóa "${ingForm.name}" khỏi danh mục kho?${extra}\nLịch sử nhập/kiểm kê cũ vẫn được giữ.`))return;
    const id=ingForm.id;
    setIngredients(v=>v.filter(x=>x.id!==id));
    if(setProducts) setProducts(prev=>prev.map(p=>({...p,recipe:(p.recipe||[]).filter(r=>r.ingredientId!==id)})));
    setIngForm({id:null,name:'',type:'Nguyên liệu',unit:'g',qty:'',minQty:'',purchasePrice:''});
    setModal(null);
  }
  function editIngredient(x){setIngForm({...x});setModal('ingredient');}
  function saveReceipt(e){e.preventDefault(); const q=Number(receipt.qty||0);if(!receipt.ingredientId||q<=0)return alert('Chọn nguyên liệu và nhập số lượng.'); const total=Number(receipt.total||0); const entered=Number(receipt.unitPrice||0); const unitPrice=entered>0?entered:(total>0?total/q:0); setIngredients(v=>v.map(x=>{if(x.id!==receipt.ingredientId)return x; const oldQty=Math.max(0,Number(x.qty||0)); const oldPrice=Number(x.purchasePrice||0); const nextQty=oldQty+q; const avg=unitPrice>0?((oldQty*oldPrice)+(q*unitPrice))/nextQty:oldPrice; return {...x,qty:nextQty,purchasePrice:Math.round(avg)};}));setReceipts(v=>[{id:`PN-${Date.now()}`,...receipt,qty:q,unitPrice,total},...v]); audit?.('Nhập kho',`${ingMap[receipt.ingredientId]?.name||''} +${q} ${ingMap[receipt.ingredientId]?.unit||''}`);setReceipt({date:todayISO(),ingredientId:'',qty:'',unitPrice:'',total:'',payment:'Chuyển khoản'});setModal(null);}
  function saveCount(e){e.preventDefault();const ing=ingMap[count.ingredientId];if(!ing)return;const actual=Number(count.actual||0),before=Number(ing.qty||0),diff=actual-before;setIngredients(v=>v.map(x=>x.id===ing.id?{...x,qty:actual}:x));setCounts(v=>[{id:`KK-${Date.now()}`,...count,name:ing.name,unit:ing.unit,before,actual,diff},...v]);setCount({date:todayISO(),ingredientId:'',actual:'',note:''});setModal(null);}
  function saveAdjust(e){e.preventDefault();const ing=ingMap[adjust.ingredientId];const q=Number(adjust.qty||0);if(!ing||!q)return;setIngredients(v=>v.map(x=>x.id===ing.id?{...x,qty:Number(x.qty||0)+q}:x));setAdjustments(v=>[{id:`DC-${Date.now()}`,...adjust,name:ing.name,unit:ing.unit,qty:q},...v]); audit?.('Điều chỉnh kho',`${ing.name} ${q>0?'+':''}${q} ${ing.unit}`);setAdjust({date:todayISO(),ingredientId:'',qty:'',reason:'Hư hao',note:''});setModal(null);}
  const history=[...receipts.map(x=>({...x,kind:'Nhập hàng',name:ingMap[x.ingredientId]?.name||'Nguyên liệu',unit:ingMap[x.ingredientId]?.unit||''})),...counts.map(x=>({...x,kind:'Kiểm kê',qty:x.diff})),...adjustments.map(x=>({...x,kind:x.reason==='Bán hàng'?'Bán hàng':'Điều chỉnh'}))].sort((a,b)=>String(b.id).localeCompare(String(a.id)));
  const inventoryValue=ingredients.reduce((s,x)=>s+Math.max(0,Number(x.qty||0))*Number(x.purchasePrice||0),0);
  return <section className="screen stock-screen"><div className="screen-head"><div><h2>Kho</h2><p>Một danh mục dùng chung cho nhập hàng, kiểm kê và trừ kho</p></div><button className="primary small" onClick={()=>setModal('ingredient')}>+ Nguyên liệu</button></div><div className="segmented stock-tabs"><button className={tab==='inventory'?'active':''} onClick={()=>setTab('inventory')}>Tồn kho</button><button className={tab==='receipts'?'active':''} onClick={()=>setTab('receipts')}>Nhập hàng</button><button className={tab==='counts'?'active':''} onClick={()=>setTab('counts')}>Kiểm kê</button><button className={tab==='history'?'active':''} onClick={()=>setTab('history')}>Lịch sử</button></div>
  {tab==='inventory'&&<><div className="card inventory-value-card"><span>TỔNG GIÁ TRỊ TỒN KHO HIỆN TẠI</span><strong>{fmt(inventoryValue)}</strong><small>Tính theo tồn hiện tại × giá nhập bình quân</small></div><div className="quick-actions stock-actions"><button onClick={()=>setModal('receipt')}>+ Nhập hàng</button><button onClick={()=>setModal('count')}>Kiểm kê</button><button onClick={()=>setModal('adjust')}>Điều chỉnh</button></div><div className="card stock-list">{ingredients.length?ingredients.map(x=><div className="stock-row" key={x.id} onClick={()=>editIngredient(x)}><div><strong>{x.name}</strong><small>{x.type} · {x.unit}{Number(x.purchasePrice)>0?` · Giá nhập TB ${fmt(x.purchasePrice)}/${x.unit}`:''}{Number(x.minQty)>0&&Number(x.qty)<=Number(x.minQty)?' · ⚠ Sắp hết':''}</small></div><span>{x.qty} {x.unit}<small>Chạm để sửa</small></span></div>):<div className="empty">Chưa có nguyên liệu hoặc bao bì. Bấm “+ Nguyên liệu” để tạo.</div>}</div></>}
  {tab==='receipts'&&<><button className="primary full" onClick={()=>setModal('receipt')}>+ Tạo phiếu nhập hàng</button><div className="card stock-list">{receipts.length?receipts.map(r=><div className="stock-row" key={r.id}><div><strong>{ingMap[r.ingredientId]?.name||'Nguyên liệu'}</strong><small>{r.date} · {r.payment}</small></div><span>+{r.qty} {ingMap[r.ingredientId]?.unit||''}<small>{r.total?fmt(r.total):''}</small></span></div>):<div className="empty">Chưa có phiếu nhập.</div>}</div></>}
  {tab==='counts'&&<><button className="primary full" onClick={()=>setModal('count')}>+ Kiểm kê kho</button><div className="card stock-list">{counts.length?counts.map(c=><div className="stock-row" key={c.id}><div><strong>{c.name}</strong><small>{c.date} · Hệ thống {c.before} {c.unit}</small></div><span>{c.actual} {c.unit}<small>Lệch {c.diff>0?'+':''}{c.diff}</small></span></div>):<div className="empty">Chưa có lần kiểm kê.</div>}</div></>}
  {tab==='history'&&<div className="card stock-list">{history.length?history.map(h=><div className="stock-row" key={h.id}><div><strong>{h.kind} · {h.name||ingMap[h.ingredientId]?.name||''}</strong><small>{h.date}{h.reason&&h.kind!=='Bán hàng'?` · ${h.reason}`:''}{h.refId?` · ${h.refId}`:''}</small></div><span>{Number(h.qty)>0?'+':''}{h.qty} {h.unit||ingMap[h.ingredientId]?.unit||''}</span></div>):<div className="empty">Chưa có lịch sử kho.</div>}</div>}
  {modal==='ingredient'&&<Modal title={ingForm.id?'Sửa nguyên liệu':'Thêm nguyên liệu'} close={()=>{setModal(null);setIngForm({id:null,name:'',type:'Nguyên liệu',unit:'g',qty:'',minQty:''})}}><form className="form-card plain" onSubmit={saveIngredient}><label>Tên<input required value={ingForm.name} onChange={e=>setIngForm({...ingForm,name:e.target.value})} placeholder="Ví dụ: Matcha / Ly 1L"/></label><label>Loại<select value={ingForm.type} onChange={e=>setIngForm({...ingForm,type:e.target.value})}><option>Nguyên liệu</option><option>Bao bì</option></select></label><label>Đơn vị<select value={ingForm.unit} onChange={e=>setIngForm({...ingForm,unit:e.target.value})}><option>g</option><option>kg</option><option>ml</option><option>lít</option><option>cái</option><option>gói</option><option>hộp</option><option>chai</option></select></label><div className="form-grid-2"><label>Tồn hiện tại<input type="number" step="0.01" value={ingForm.qty} onChange={e=>setIngForm({...ingForm,qty:e.target.value})}/></label><label>Cảnh báo dưới<input type="number" step="0.01" value={ingForm.minQty} onChange={e=>setIngForm({...ingForm,minQty:e.target.value})}/></label></div><label>Giá nhập bình quân / {ingForm.unit}<input type="number" min="0" value={ingForm.purchasePrice||''} onChange={e=>setIngForm({...ingForm,purchasePrice:e.target.value})} placeholder="Tự cập nhật từ phiếu nhập"/><small className="hint">Dùng để tính giá trị tồn kho. Có thể chỉnh tay nếu cần.</small></label><button className="primary full">Lưu</button>{ingForm.id&&<button type="button" className="danger full ingredient-delete-btn" onClick={deleteIngredient}>Xóa nguyên liệu</button>}</form></Modal>}
  {modal==='receipt'&&<Modal title="Phiếu nhập hàng" close={()=>setModal(null)}><form className="form-card plain" onSubmit={saveReceipt}><label>Ngày nhập<input type="date" value={receipt.date} onChange={e=>setReceipt({...receipt,date:e.target.value})}/></label><label>Nguyên liệu / bao bì<select required value={receipt.ingredientId} onChange={e=>setReceipt({...receipt,ingredientId:e.target.value})}><option value="">Chọn từ danh mục kho</option>{ingredients.map(x=><option key={x.id} value={x.id}>{x.name} · {x.unit}</option>)}</select></label><label>Số lượng<input required type="number" step="0.01" value={receipt.qty} onChange={e=>setReceipt({...receipt,qty:e.target.value})}/></label><label>Giá nhập / đơn vị <small className="hint">Không bắt buộc</small><input type="number" min="0" value={receipt.unitPrice||''} onChange={e=>setReceipt({...receipt,unitPrice:e.target.value})} placeholder="Bỏ trống để lấy Tổng tiền / Số lượng"/></label><label>Tổng tiền<input type="number" value={receipt.total} onChange={e=>setReceipt({...receipt,total:e.target.value})}/></label><label>Thanh toán<select value={receipt.payment} onChange={e=>setReceipt({...receipt,payment:e.target.value})}><option>Tiền mặt</option><option>Chuyển khoản</option></select></label><button className="primary full">Lưu phiếu nhập</button></form></Modal>}
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

function Reports({orders,products,receipts=[],transactions=[],openOrder}){
  const today=todayISO();
  const [viewMode,setViewMode]=useState('month');
  const [month,setMonth]=useState(today.slice(0,7));
  const [day,setDay]=useState(today);
  const [tab,setTab]=useState('overview');
  const [selectedRevenueDay,setSelectedRevenueDay]=useState(null);

  useEffect(()=>{setSelectedRevenueDay(null)},[month]);

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
        {selectedRevenueDay&&<div className="chart-selected-value"><span>Ngày {Number(selectedRevenueDay.day)}/{Number(month.split('-')[1])}</span><strong>{fmt(selectedRevenueDay.value)}</strong></div>}
        <div className="bar-chart daily-chart">
          {dailyRows.map(x=><button type="button" className={'bar-col '+(selectedRevenueDay?.day===x.day?'selected':'')} key={x.day} title={`Ngày ${x.day}: ${fmt(x.value)}`} onClick={()=>setSelectedRevenueDay(x)}>
            <div className="bar-wrap"><div className="bar-value" style={{height:`${Math.max(x.value?6:0,(x.value/maxDaily)*100)}%`}}></div></div>
            <small>{Number(x.day)}</small>
          </button>)}
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

    {viewMode==='day'&&<div className="card report-day-orders">
      <div className="report-day-orders-head"><div><div className="section-title">Danh sách đơn ngày {day.split('-').reverse().join('/')}</div><p>{validOrders.length} đơn · {fmt(revenue)}</p></div></div>
      <div className="orders-list compact-orders-list">
        {validOrders.length
          ? validOrders.slice().sort((a,b)=>String(b.time||'').localeCompare(String(a.time||''))).map(o=><button className="order-row" key={o.id} onClick={()=>openOrder&&openOrder(o)}><div><strong>{o.source}</strong><small>{o.time} · {o.totalQty} ly / sản phẩm</small><span className={'status '+(o.status==='Đã hủy'?'cancel':'')}>{o.status}</span></div><div className="order-money"><strong>{fmt(o.total)}</strong><small>{o.payment}</small><span>›</span></div></button>)
          : <div className="empty">Ngày này chưa có đơn.</div>}
      </div>
    </div>}

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



function EmployeeAccounts({user,shop,back}){
  const [employees,setEmployees]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showCreate,setShowCreate]=useState(false);
  const [form,setForm]=useState({username:'',displayName:'',password:''});
  const [busy,setBusy]=useState(false);
  const [showPassword,setShowPassword]=useState(false);

  async function load(){
    if(!shop?.id)return;
    setLoading(true);
    const {data,error}=await supabase
      .from('shop_members')
      .select('member_user_id,username,display_name,role,active,created_at')
      .eq('shop_id',shop.id)
      .order('created_at',{ascending:true});
    if(error) alert(error.message);
    setEmployees(data||[]);
    setLoading(false);
  }
  useEffect(()=>{load();},[shop?.id]);

  async function createEmployee(e){
    e.preventDefault();
    const username=form.username.trim().toLowerCase();
    if(!username||!form.password)return alert('Vui lòng nhập tên đăng nhập và mật khẩu.');
    if(!/^[a-z0-9._-]+$/.test(username))return alert('Tên đăng nhập chỉ dùng chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới.');
    setBusy(true);
    const {data:{session}}=await supabase.auth.getSession();
    const res=await fetch('/api/employees',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${session?.access_token||''}`},
      body:JSON.stringify({shopId:shop.id,username,password:form.password,displayName:form.displayName.trim()||username})
    });
    const data=await res.json().catch(()=>({}));
    setBusy(false);
    if(!res.ok)return alert(data.error||'Không tạo được tài khoản.');
    setForm({username:'',displayName:'',password:''}); setShowCreate(false); load();
  }

  async function toggleEmployee(emp){
    const {error}=await supabase.from('shop_members')
      .update({active:!emp.active})
      .eq('member_user_id',emp.member_user_id)
      .eq('shop_id',shop.id);
    if(error)return alert(error.message);
    load();
  }

  return <section className="screen employee-screen">
    <div className="screen-head"><div><h2>Tài khoản nhân viên</h2><p>Nhân viên đăng nhập bằng Mã quán + tên đăng nhập + mật khẩu.</p></div><button className="secondary small" onClick={back}>← Quay lại</button></div>
    <div className="card shop-code-card"><span>MÃ QUÁN</span><strong>{shop?.code||'—'}</strong><small>Gửi mã này cùng tài khoản cho nhân viên mới.</small></div>
    <button className="primary full employee-create-btn" onClick={()=>setShowCreate(true)}>+ Tạo tài khoản nhân viên</button>
    <div className="card employee-list">
      {loading&&<div className="empty">Đang tải…</div>}
      {!loading&&!employees.length&&<div className="empty">Chưa có tài khoản nhân viên.</div>}
      {employees.map(emp=><div className="employee-row" key={emp.member_user_id}><div><strong>{emp.display_name||emp.username}</strong><small>Tên đăng nhập: {emp.username}</small><span className={'status '+(!emp.active?'cancel':'')}>{emp.active?'Đang hoạt động':'Đã khóa'}</span></div><button className={emp.active?'secondary':'primary'} onClick={()=>toggleEmployee(emp)}>{emp.active?'Khóa':'Mở lại'}</button></div>)}
    </div>
    {showCreate&&<Modal title="Tạo tài khoản nhân viên" close={()=>setShowCreate(false)} className="employee-modal"><form className="form-card plain" onSubmit={createEmployee}>
      <div className="mini-shop-code">Mã quán: <strong>{shop?.code}</strong></div>
      <label>Tên nhân viên<input value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})} placeholder="Ví dụ: Minh"/></label>
      <label>Tên đăng nhập<input required autoCapitalize="none" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} placeholder="Ví dụ: nv01"/></label>
      <label>Mật khẩu<div className="password-field"><input required minLength={6} type={showPassword?'text':'password'} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Tối thiểu 6 ký tự"/><button type="button" className="password-eye" onClick={()=>setShowPassword(v=>!v)}>{showPassword?'◉':'◌'}</button></div></label>
      <p className="hint">Nhân viên chỉ thấy Order và tài khoản của họ.</p>
      <button className="primary full" disabled={busy}>{busy?'Đang tạo…':'Tạo tài khoản'}</button>
    </form></Modal>}
  </section>
}

function ShopSetup({shop,products,ingredients,openingBalances,go,back}){
  const steps=[
    {name:'Thông tin quán',done:!!(shop?.name&&shop?.phone),hint:'Kiểm tra tên quán, số điện thoại và địa chỉ.',go:'shopSettings'},
    {name:'Menu & giá bán',done:(products||[]).length>0,hint:'Tạo menu mẫu hoặc import menu Excel.',go:'products'},
    {name:'Nguyên liệu',done:(ingredients||[]).length>0,hint:'Tạo các nguyên liệu và bao bì cần theo dõi.',go:'stock'},
    {name:'Set trừ kho',done:(products||[]).some(p=>(p.recipe||[]).length>0),hint:'Gán lượng nguyên liệu bị trừ khi bán từng món.',go:'products'},
    {name:'Tồn kho / số dư đầu kỳ',done:(ingredients||[]).some(x=>Number(x.qty||0)>0)||Number(openingBalances?.cash||0)>0||Number(openingBalances?.bank||0)>0,hint:'Nhập tồn hiện tại và số dư ban đầu để báo cáo chính xác.',go:'stock'}
  ];
  const done=steps.filter(x=>x.done).length, pct=Math.round(done/steps.length*100);
  return <section className="screen"><div className="screen-head"><div><h2>Thiết lập quán</h2><p>Không bắt buộc. Hoàn thành dần để app báo cáo chính xác hơn.</p></div><button className="secondary small" onClick={back}>← Cài đặt</button></div>
    <div className="card setup-progress-card"><div><strong>{pct}% hoàn thành</strong><span>{done}/{steps.length} mục</span></div><div className="setup-progress"><i style={{width:`${pct}%`}}/></div></div>
    <div className="setup-step-list">{steps.map((s,i)=><div className={'card setup-step '+(s.done?'done':'')} key={s.name}><span className="setup-check">{s.done?'✓':i+1}</span><div><strong>{s.name}</strong><small>{s.hint}</small><button className="guide-placeholder" disabled>Hướng dẫn · sẽ bổ sung</button></div><button className="secondary small" onClick={()=>go(s.go)}>{s.done?'Xem lại':'Thiết lập'}</button></div>)}</div>
  </section>
}

function ForcePasswordChange(){
  const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false);
  async function save(e){e.preventDefault();if(password.length<6)return alert('Mật khẩu cần ít nhất 6 ký tự.');setBusy(true);const {error}=await supabase.auth.updateUser({password,data:{force_password_change:false}});setBusy(false);if(error)return alert(error.message);alert('Đã tạo mật khẩu mới.');window.location.reload();}
  return <div className="modal-backdrop force-password-backdrop"><div className="modal-card"><div className="modal-head"><h3>Tạo mật khẩu mới</h3></div><p className="hint">Admin vừa cấp mật khẩu tạm. Hãy đặt mật khẩu mới trước khi tiếp tục sử dụng.</p><form className="form-card plain" onSubmit={save}><label>Mật khẩu mới<input type="password" minLength={6} required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="primary full" disabled={busy}>{busy?'Đang lưu…':'Lưu mật khẩu mới'}</button></form></div></div>
}

function ShopSettings({shop,setShop,user,back}){
  const [form,setForm]=useState({name:shop?.name||'',phone:shop?.phone||'',address:shop?.address||''});
  const [busy,setBusy]=useState(false);
  const [password,setPassword]=useState('');
  const [showPassword,setShowPassword]=useState(false);

  async function save(e){
    e.preventDefault(); setBusy(true);
    const payload={name:form.name.trim(),phone:form.phone.trim()||null,address:form.address.trim()||null};
    const {data,error}=await supabase.from('shops').update(payload).eq('id',shop.id).select('id,code,name,phone,address,plan,status,owner_user_id,created_at').single();
    setBusy(false);
    if(error)return alert(error.message);
    setShop(data); alert('Đã cập nhật thông tin quán.');
  }

  async function changePassword(e){
    e.preventDefault();
    if(password.length<6)return alert('Mật khẩu cần ít nhất 6 ký tự.');
    setBusy(true);
    const {error}=await supabase.auth.updateUser({password});
    setBusy(false);
    if(error)return alert(error.message);
    setPassword(''); alert('Đã đổi mật khẩu.');
  }

  return <section className="screen">
    <div className="screen-head"><div><h2>Thông tin quán</h2><p>Thông tin nhận diện không gian làm việc hiện tại.</p></div><button className="secondary small" onClick={back}>← Quay lại</button></div>
    <div className="card shop-plan-card"><div><span>GÓI HIỆN TẠI</span><strong>{String(shop?.plan||'free').toUpperCase()}</strong></div><div><span>MÃ QUÁN</span><strong>{shop?.code}</strong></div></div>
    <form className="card form-card" onSubmit={save}>
      <label>Tên quán<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label>Số điện thoại<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
      <label>Địa chỉ<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label>
      <button className="primary full" disabled={busy}>{busy?'Đang lưu…':'Lưu thông tin quán'}</button>
    </form>
    <form className="card form-card" onSubmit={changePassword}>
      <div className="section-title">Đổi mật khẩu chủ quán</div>
      <label>Mật khẩu mới<div className="password-field"><input type={showPassword?'text':'password'} minLength={6} required value={password} onChange={e=>setPassword(e.target.value)}/><button type="button" className="password-eye" onClick={()=>setShowPassword(v=>!v)}>{showPassword?'◉':'◌'}</button></div></label>
      <button className="secondary full" disabled={busy}>Đổi mật khẩu</button>
    </form>
  </section>
}

function SaasAdminDashboard({user,back}){
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [summary,setSummary]=useState(null);
  const [shops,setShops]=useState([]);
  const [search,setSearch]=useState('');
  const [activity,setActivity]=useState('all');
  const [selectedShop,setSelectedShop]=useState(null);
  const [detail,setDetail]=useState(null);
  const [detailLoading,setDetailLoading]=useState(false);

  async function adminFetch(params=''){
    const {data:{session}}=await supabase.auth.getSession();
    const res=await fetch(`/api/admin/saas${params}`,{
      headers:{'Authorization':`Bearer ${session?.access_token||''}`}
    });
    const body=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(body.error||'Không tải được dữ liệu Admin.');
    return body;
  }

  async function loadOverview(silent=false){
    if(!silent)setLoading(true);
    setError('');
    try{
      const data=await adminFetch('?action=overview');
      setSummary(data.summary||null);
      setShops(data.shops||[]);
    }catch(e){setError(e.message);}
    if(!silent)setLoading(false);
  }

  useEffect(()=>{
    loadOverview();
    const timer=setInterval(()=>loadOverview(true),15000);
    const onFocus=()=>loadOverview(true);
    window.addEventListener('focus',onFocus);
    return()=>{clearInterval(timer);window.removeEventListener('focus',onFocus);};
  },[]);

  async function openShop(shopRow){
    setSelectedShop(shopRow);
    setDetail(null);
    setDetailLoading(true);
    try{
      const data=await adminFetch(`?action=shop&shopId=${encodeURIComponent(shopRow.id)}`);
      setDetail(data);
    }catch(e){
      alert(e.message);
      setSelectedShop(null);
    }
    setDetailLoading(false);
  }

  async function setShopStatus(shopRow,status){
    const labels={approved:'duyệt',rejected:'không duyệt',suspended:'tạm ngưng',locked:'khóa',active:'kích hoạt lại'};
    if(!confirm(`Xác nhận ${labels[status]||status} quán "${shopRow.name}"?`))return;
    try{
      const {data:{session}}=await supabase.auth.getSession();
      const res=await fetch('/api/admin/saas',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${session?.access_token||''}`},
        body:JSON.stringify({action:'status',shopId:shopRow.id,status})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.error||'Không cập nhật được trạng thái.');
      setShops(rows=>rows.map(s=>s.id===shopRow.id?{...s,status:body.status}:s));
      if(selectedShop?.id===shopRow.id){
        setSelectedShop(s=>({...s,status:body.status}));
        setDetail(d=>d?{...d,shop:{...d.shop,status:body.status}}:d);
      }
    }catch(e){alert(e.message);}
  }

  async function resetTemporaryPassword(shopRow){
    const temp=prompt(`Nhập mật khẩu tạm cho ${shopRow.name} (ít nhất 6 ký tự):`);
    if(!temp)return; if(temp.length<6)return alert('Mật khẩu tạm cần ít nhất 6 ký tự.');
    try{const {data:{session}}=await supabase.auth.getSession();const res=await fetch('/api/admin/saas',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session?.access_token||''}`},body:JSON.stringify({action:'reset_password',shopId:shopRow.id,password:temp})});const body=await res.json().catch(()=>({}));if(!res.ok)throw new Error(body.error||'Không cấp được mật khẩu.');alert('Đã cấp mật khẩu tạm. User sẽ phải đổi mật khẩu sau khi đăng nhập.');}catch(e){alert(e.message);}
  }

  const filtered=shops.filter(s=>{
    const q=search.trim().toLowerCase();
    const matchesSearch=!q || [
      s.name,s.code,s.phone,s.email,s.owner_phone
    ].some(v=>String(v||'').toLowerCase().includes(q));
    if(!matchesSearch)return false;
    if(activity==='pending')return s.status==='pending';
    if(activity==='suspended')return s.status==='suspended';
    if(activity==='locked')return s.status==='locked';
    if(activity==='rejected')return s.status==='rejected';
    if(activity==='active')return ['active','approved'].includes(s.status)&&Number(s.orders_30d||0)>0;
    if(activity==='inactive')return ['active','approved'].includes(s.status)&&Number(s.orders_30d||0)===0;
    return true;
  });

  function money(n){return `${Math.round(Number(n||0)).toLocaleString('vi-VN')}đ`;}
  function shortDate(v){
    if(!v)return '—';
    const d=new Date(v);
    if(Number.isNaN(d.getTime()))return String(v);
    return new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
  }

  function exportCsv(){
    const rows=[
      ['Mã quán','Tên quán','SĐT','Email','Ngày đăng ký','Đơn 30 ngày','Doanh thu 30 ngày','Tổng đơn','Tổng doanh thu','Cập nhật cuối'],
      ...filtered.map(s=>[
        s.code||'',s.name||'',displayOwnerPhone(s.owner_phone||s.phone||''),s.email||'',
        shortDate(s.created_at),s.orders_30d||0,s.revenue_30d||0,s.total_orders||0,s.total_revenue||0,s.updated_at||''
      ])
    ];
    const csv='\ufeff'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=`saas-users-${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if(selectedShop){
    return <section className="screen saas-admin-screen">
      <div className="screen-head admin-detail-head">
        <div><div className="saas-admin-kicker">ADMIN · VIEW ONLY</div><h2>{selectedShop.name}</h2><p>Mã quán {selectedShop.code} · {displayOwnerPhone(selectedShop.owner_phone||'')||'Chưa có SĐT'}</p></div>
        <button className="secondary small" onClick={()=>{setSelectedShop(null);setDetail(null)}}>← Danh sách quán</button>
      </div>

      {detailLoading&&<div className="card empty">Đang tải dữ liệu quán…</div>}
      {!detailLoading&&detail&&<>
        <div className="admin-stat-grid">
          <div className="card admin-stat"><span>Hôm nay</span><strong>{money(detail.today?.revenue)}</strong><small>{detail.today?.orders||0} đơn</small></div>
          <div className="card admin-stat"><span>30 ngày</span><strong>{money(detail.last30?.revenue)}</strong><small>{detail.last30?.orders||0} đơn</small></div>
          <div className="card admin-stat"><span>Toàn thời gian</span><strong>{money(detail.allTime?.revenue)}</strong><small>{detail.allTime?.orders||0} đơn</small></div>
          <div className="card admin-stat"><span>Cập nhật cuối</span><strong className="admin-stat-date">{detail.shop?.updated_at?shortDate(detail.shop.updated_at):'—'}</strong><small>{detail.active_days_30d||0} ngày có đơn / 30 ngày</small></div>
        </div>

        <div className="admin-detail-grid">
          <div className="card">
            <div className="section-title">Thông tin chủ quán</div>
            <div className="admin-info-list">
              <div><span>SĐT</span><strong>{displayOwnerPhone(detail.profile?.phone||'')||'—'}</strong></div>
              <div><span>Email</span><strong>{detail.profile?.email||'—'}</strong></div>
              <div><span>Ngày đăng ký</span><strong>{shortDate(detail.shop?.created_at)}</strong></div>
              <div><span>Loại hình</span><strong>{detail.shop?.business_type||'—'}</strong></div>
              <div><span>Menu mẫu</span><strong>{detail.shop?.menu_preset||'—'}</strong></div>
              <div><span>Địa chỉ</span><strong>{detail.shop?.address||'—'}</strong></div>
              <div><span>Gói</span><strong>{String(detail.shop?.plan||'free').toUpperCase()}</strong></div>
            </div>
          </div>

          <div className="card">
            <div className="section-title">Nguồn đơn · 30 ngày</div>
            <div className="admin-source-list">
              {(detail.sources||[]).length===0&&<div className="empty compact">Chưa có dữ liệu.</div>}
              {(detail.sources||[]).map(x=><div key={x.source}><span>{x.source}</span><div><strong>{x.orders} đơn</strong><small>{money(x.revenue)}</small></div></div>)}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-title">Món bán chạy · 30 ngày</div>
          {(detail.top_products||[]).length===0?<div className="empty">Chưa có đơn trong 30 ngày.</div>:
          <div className="admin-product-table">
            <div className="admin-table-row admin-table-head"><span>Món</span><span>SL</span><span>Doanh thu</span></div>
            {detail.top_products.map((p,i)=><div className="admin-table-row" key={`${p.name}-${i}`}><span><b>{i+1}.</b> {p.name}</span><strong>{p.qty}</strong><strong>{money(p.revenue)}</strong></div>)}
          </div>}
        </div>

        <div className="card admin-insight-card">
          <div className="section-title">Tư liệu nghiên cứu</div>
          <p>Dashboard này chỉ đọc. Khi dùng số liệu của quán cho quảng cáo/case study, nên ẩn danh hoặc xin phép chủ quán trước khi dùng tên, logo hay số liệu nhận diện cụ thể.</p>
        </div>
      </>}
    </section>
  }

  return <section className="screen saas-admin-screen">
    <div className="screen-head">
      <div><div className="saas-admin-kicker">QUẢN TRỊ HỆ THỐNG</div><h2>Admin SaaS</h2><p>Theo dõi đăng ký và mức độ sử dụng Free Beta.</p></div>
      <button className="secondary small" onClick={back}>← Cài đặt</button>
    </div>

    {loading&&<div className="card empty">Đang tải dữ liệu hệ thống…</div>}
    {error&&<div className="card auth-message">{error}<button className="secondary small" onClick={loadOverview}>Thử lại</button></div>}

    {!loading&&!error&&<>
      <div className="admin-stat-grid">
        <div className="card admin-stat"><span>Tổng user</span><strong>{summary?.total_users||0}</strong><small>chủ quán đã đăng ký</small></div>
        <div className="card admin-stat"><span>User quay lại · 7 ngày</span><strong>{summary?.returning_users_7d||0}</strong><small>{summary?.active_users_7d||0} user hoạt động · {summary?.retention_7d||0}% quay lại</small></div><div className="card admin-stat"><span>User quay lại · 30 ngày</span><strong>{summary?.returning_users_30d||0}</strong><small>{summary?.active_users_30d||0} user hoạt động</small></div><div className="card admin-stat"><span>Tổng quán</span><strong>{summary?.total_shops||0}</strong><small>{summary?.pending_shops||0} chờ duyệt · {summary?.active_shops_30d||0} có đơn 30 ngày</small></div>
        <div className="card admin-stat"><span>User mới · 7 ngày</span><strong>{summary?.new_users_7d||0}</strong><small>{summary?.new_users_today||0} đăng ký hôm nay</small></div>
        <div className="card admin-stat"><span>GMV · 30 ngày</span><strong>{money(summary?.revenue_30d)}</strong><small>{summary?.orders_30d||0} đơn</small></div>
      </div>

      <div className="card admin-toolbar">
        <div className="admin-search-wrap"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Tìm SĐT, email, tên quán, mã quán…"/></div>
        <select value={activity} onChange={e=>setActivity(e.target.value)}>
          <option value="all">Tất cả quán</option>
          <option value="pending">Chờ xét duyệt</option>
          <option value="active">Có đơn 30 ngày</option>
          <option value="inactive">Chưa có đơn 30 ngày</option>
          <option value="suspended">Đang tạm ngưng</option>
          <option value="locked">Đã khóa</option>
          <option value="rejected">Không duyệt</option>
        </select>
        <button className="secondary" onClick={exportCsv}>Xuất CSV</button>
      </div>

      <div className="card admin-shop-list">
        <div className="admin-shop-list-head"><strong>{filtered.length} quán</strong><small>Bấm quán để xem tình hình kinh doanh · chỉ đọc</small></div>
        {!filtered.length&&<div className="empty">Không có kết quả phù hợp.</div>}
        {filtered.map(s=><button className="admin-shop-row" key={s.id} onClick={()=>openShop(s)}>
          <div className="admin-shop-main">
            <div><strong>{s.name}</strong><span>{s.code}</span></div>
            <small>{displayOwnerPhone(s.owner_phone||s.phone||'')||'Chưa có SĐT'}{s.email?` · ${s.email}`:''}</small>
            <small className="admin-shop-type">{s.business_type||'Chưa chọn loại hình'}{s.address?` · ${s.address}`:''}</small>
          </div>
          <div className="admin-shop-metric"><span>30 ngày</span><strong>{money(s.revenue_30d)}</strong><small>{s.orders_30d||0} đơn</small></div>
          <div className="admin-shop-last"><span>Đăng ký</span><strong>{shortDate(s.created_at)}</strong><small className={`shop-status ${s.status||'active'}`}>{s.status==='pending'?'Chờ duyệt':s.status==='rejected'?'Không duyệt':s.status==='suspended'?'Tạm ngưng':s.status==='locked'?'Đã khóa':'Đang hoạt động'}</small></div>
          <div className="admin-row-actions" onClick={e=>e.stopPropagation()}><button onClick={()=>resetTemporaryPassword(s)}>Cấp MK tạm</button>
            {s.status==='pending'&&<><button className="approve" onClick={()=>setShopStatus(s,'approved')}>Duyệt</button><button onClick={()=>setShopStatus(s,'rejected')}>Không duyệt</button></>}
            {['active','approved'].includes(s.status)&&<><button onClick={()=>setShopStatus(s,'suspended')}>Tạm ngưng</button><button className="danger" onClick={()=>setShopStatus(s,'locked')}>Khóa</button></>}
            {['suspended','locked','rejected'].includes(s.status)&&<button className="approve" onClick={()=>setShopStatus(s,'active')}>Kích hoạt</button>}
          </div>
          <span className="admin-shop-arrow">›</span>
        </button>)}
      </div>
    </>}
  </section>
}

function AuditLog({shop,back}){
  const [rows,setRows]=useState([]); const [loading,setLoading]=useState(true);
  useEffect(()=>{let alive=true;(async()=>{const {data,error}=await supabase.from('audit_logs').select('id,action,detail,actor_label,created_at').eq('shop_id',shop.id).order('created_at',{ascending:false}).limit(200);if(alive){if(!error)setRows(data||[]);setLoading(false);}})();return()=>{alive=false};},[shop?.id]);
  return <section className="screen"><div className="screen-head"><div><h2>Nhật ký hoạt động</h2><p>200 thao tác gần nhất của quán.</p></div><button className="secondary small" onClick={back}>← Cài đặt</button></div><div className="card audit-list">{loading?<div className="empty">Đang tải…</div>:rows.length?rows.map(r=><div className="audit-row" key={r.id}><div><strong>{r.action}</strong><small>{r.detail||'—'}</small></div><div><strong>{r.actor_label||'Tài khoản quán'}</strong><small>{new Date(r.created_at).toLocaleString('vi-VN')}</small></div></div>):<div className="empty">Chưa có nhật ký.</div>}</div></section>
}

function More({go,user,onSignOut,syncState,role='admin',memberInfo=null,shop=null,pendingCount=0}){
  const isAdmin=role==='admin';
  const isSaasAdmin=isAdmin&&isSaasAdminUser(user);
  return <section className="screen">
    <h2>{isAdmin?'Cài đặt':'Tài khoản'}</h2>
    <div className="card account-card">
      <div>
        <div className="muted">{shop?.name||'QUÁN'}</div>
        <strong>{isAdmin?'Chủ quán':`${memberInfo?.display_name||memberInfo?.username||'Nhân viên'} · Nhân viên`}</strong>
        <small>{isAdmin?`Gói Free · Mã quán ${shop?.code||'—'}`:(syncState==='saving'?'Đang đồng bộ dữ liệu…':syncState==='error'?'Có lỗi đồng bộ':'Dữ liệu đã đồng bộ')}</small>
      </div>
      <button className="secondary" onClick={onSignOut}>Đăng xuất</button>
    </div>

    {isSaasAdmin&&<button className="saas-admin-entry" onClick={()=>go('saasAdmin')}>
      <div><span className="saas-admin-kicker">QUẢN TRỊ HỆ THỐNG</span><strong>Admin SaaS Dashboard {pendingCount>0&&<span className="inline-pending-count">{pendingCount}</span>}</strong><small>{pendingCount>0?`${pendingCount} quán đang chờ duyệt`:'User · Quán · Doanh thu · Mức độ sử dụng'}</small></div>
      <span>›</span>
    </button>}

    {isAdmin&&<div className="report-menu">
      <button onClick={()=>go('shopSetup')}>Thiết lập quán <span>›</span></button>
      <button onClick={()=>go('shopSettings')}>Thông tin quán & tài khoản <span>›</span></button>
      <button onClick={()=>go('employees')}>Tài khoản nhân viên <span>›</span></button>
      <button onClick={()=>go('foodapp')}>Nhập đơn từ App Food <span>›</span></button>
      <button onClick={()=>go('products')}>Món & giá vốn <span>›</span></button>
      <button onClick={()=>go('stock')}>Nguyên liệu & kho <span>›</span></button>
      <button onClick={()=>go('closeDay')}>Chốt ngày <span>›</span></button>
      <button onClick={()=>go('auditLog')}>Nhật ký hoạt động <span>›</span></button>
      <a className="settings-support-link" href="https://zalo.me/0332995337" target="_blank" rel="noreferrer">Hỗ trợ / Báo lỗi <span>›</span></a>
    </div>}
  </section>
}

