import { createClient } from '@supabase/supabase-js';

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
const VN_TZ='Asia/Ho_Chi_Minh';

function vnDate(date=new Date()){
  return new Intl.DateTimeFormat('en-CA',{
    timeZone:VN_TZ,year:'numeric',month:'2-digit',day:'2-digit'
  }).format(date);
}
function dateDaysAgo(days){
  const d=new Date();
  d.setUTCDate(d.getUTCDate()-days);
  return vnDate(d);
}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function orderDate(o){return String(o?.date||'').slice(0,10);}
function orderTotal(o){return num(o?.total ?? o?.finalTotal ?? o?.actualTotal);}
function itemsOf(o){return Array.isArray(o?.items)?o.items:[];}

async function requireAdmin(request){
  if(!url||!anon||!service)throw Object.assign(new Error('Thiếu cấu hình Supabase.'),{status:500});

  const auth=request.headers.get('authorization')||'';
  const token=auth.startsWith('Bearer ')?auth.slice(7):'';
  if(!token)throw Object.assign(new Error('Chưa đăng nhập.'),{status:401});

  const userClient=createClient(url,anon,{
    global:{headers:{Authorization:`Bearer ${token}`}},
    auth:{persistSession:false}
  });
  const {data,error}=await userClient.auth.getUser(token);
  const user=data?.user;
  if(error||!user)throw Object.assign(new Error('Phiên đăng nhập không hợp lệ.'),{status:401});

  const allowByEmail=String(user.email||'').toLowerCase()==='admin@tiemnhage.local';
  const allowByMetadata=user.user_metadata?.saas_admin===true;
  const allowByEnv=process.env.SAAS_ADMIN_USER_ID && process.env.SAAS_ADMIN_USER_ID===user.id;

  if(!allowByEmail&&!allowByMetadata&&!allowByEnv){
    throw Object.assign(new Error('Bạn không có quyền Admin SaaS.'),{status:403});
  }
  return user;
}

function summarizeOrders(orders=[]){
  const today=vnDate();
  const from30=dateDaysAgo(29);
  let totalRevenue=0,revenue30=0,todayRevenue=0;
  let orders30=0,todayOrders=0;
  const activeDays=new Set();
  const sources=new Map();
  const products=new Map();

  for(const o of orders){
    const d=orderDate(o);
    const total=orderTotal(o);
    totalRevenue+=total;

    if(d===today){
      todayRevenue+=total;
      todayOrders+=1;
    }
    if(d && d>=from30 && d<=today){
      revenue30+=total;
      orders30+=1;
      activeDays.add(d);

      const source=String(o?.source||'Khác');
      const sourceRow=sources.get(source)||{source,orders:0,revenue:0};
      sourceRow.orders+=1; sourceRow.revenue+=total;
      sources.set(source,sourceRow);

      for(const item of itemsOf(o)){
        const name=String(item?.name||item?.productName||'Không tên');
        const qty=num(item?.qty||item?.quantity||1);
        const unitPrice=num(item?.price||item?.unitPrice||0);
        const row=products.get(name)||{name,qty:0,revenue:0};
        row.qty+=qty;
        row.revenue+=unitPrice*qty;
        products.set(name,row);
      }
    }
  }

  return {
    total_orders:orders.length,
    total_revenue:totalRevenue,
    orders_30d:orders30,
    revenue_30d:revenue30,
    today:{orders:todayOrders,revenue:todayRevenue},
    active_days_30d:activeDays.size,
    sources:[...sources.values()].sort((a,b)=>b.revenue-a.revenue),
    top_products:[...products.values()].sort((a,b)=>b.qty-a.qty||b.revenue-a.revenue).slice(0,10)
  };
}

export async function GET(request){
  try{
    await requireAdmin(request);
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const {searchParams}=new URL(request.url);
    const action=searchParams.get('action')||'overview';

    if(action==='shop'){
      const shopId=searchParams.get('shopId');
      if(!shopId)return Response.json({error:'Thiếu shopId.'},{status:400});

      const {data:shop,error:shopError}=await admin
        .from('shops')
        .select('id,code,name,phone,address,plan,status,owner_user_id,created_at,updated_at')
        .eq('id',shopId)
        .maybeSingle();
      if(shopError)throw shopError;
      if(!shop)return Response.json({error:'Không tìm thấy quán.'},{status:404});

      const [{data:profile},{data:state,error:stateError}]=await Promise.all([
        admin.from('user_profiles').select('phone,email,approval_status,created_at').eq('user_id',shop.owner_user_id).maybeSingle(),
        admin.from('app_states').select('orders,updated_at').eq('shop_id',shopId).maybeSingle()
      ]);
      if(stateError)throw stateError;

      const metrics=summarizeOrders(Array.isArray(state?.orders)?state.orders:[]);
      return Response.json({
        shop:{...shop,updated_at:state?.updated_at||shop.updated_at},
        profile:profile||null,
        today:metrics.today,
        last30:{orders:metrics.orders_30d,revenue:metrics.revenue_30d},
        allTime:{orders:metrics.total_orders,revenue:metrics.total_revenue},
        active_days_30d:metrics.active_days_30d,
        sources:metrics.sources,
        top_products:metrics.top_products
      });
    }

    // overview
    const [{data:shops,error:shopsError},{data:profiles,error:profilesError},{data:states,error:statesError}]=await Promise.all([
      admin.from('shops').select('id,code,name,phone,address,plan,status,owner_user_id,created_at,updated_at').order('created_at',{ascending:false}),
      admin.from('user_profiles').select('user_id,phone,email,approval_status,created_at'),
      admin.from('app_states').select('shop_id,orders,updated_at')
    ]);
    if(shopsError)throw shopsError;
    if(profilesError)throw profilesError;
    if(statesError)throw statesError;

    const profileByUser=new Map((profiles||[]).map(p=>[p.user_id,p]));
    const stateByShop=new Map((states||[]).map(s=>[s.shop_id,s]));
    const today=vnDate();
    const sevenDaysAgo=dateDaysAgo(6);

    let activeShops30=0,orders30=0,revenue30=0,newToday=0,new7=0,pendingShops=0;

    const rows=(shops||[]).map(s=>{
      const p=profileByUser.get(s.owner_user_id)||{};
      const st=stateByShop.get(s.id)||{};
      const metrics=summarizeOrders(Array.isArray(st.orders)?st.orders:[]);
      if((p.approval_status||s.status)==='pending')pendingShops+=1;
      if(metrics.orders_30d>0)activeShops30+=1;
      orders30+=metrics.orders_30d;
      revenue30+=metrics.revenue_30d;

      const createdDate=String(s.created_at||'').slice(0,10);
      if(createdDate===today)newToday+=1;
      if(createdDate>=sevenDaysAgo && createdDate<=today)new7+=1;

      return {
        id:s.id,code:s.code,name:s.name,phone:s.phone,email:p.email||null,owner_phone:p.phone||null,
        plan:s.plan,status:p.approval_status||s.status||'active',created_at:s.created_at,updated_at:st.updated_at||s.updated_at,
        total_orders:metrics.total_orders,total_revenue:metrics.total_revenue,
        orders_30d:metrics.orders_30d,revenue_30d:metrics.revenue_30d
      };
    });

    return Response.json({
      summary:{
        total_users:(profiles||[]).length,
        total_shops:(shops||[]).length,
        active_shops_30d:activeShops30,
        pending_shops:pendingShops,
        new_users_today:newToday,
        new_users_7d:new7,
        orders_30d:orders30,
        revenue_30d:revenue30
      },
      shops:rows
    });
  }catch(e){
    return Response.json({error:e?.message||'Có lỗi khi tải Admin SaaS.'},{status:e?.status||500});
  }
}


export async function POST(request){
  try{
    await requireAdmin(request);
    const body=await request.json();
    if(body.action!=='status')return Response.json({error:'Hành động không hợp lệ.'},{status:400});
    const allowed=['approved','active','rejected','suspended','locked'];
    if(!allowed.includes(body.status))return Response.json({error:'Trạng thái không hợp lệ.'},{status:400});

    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:shop,error:shopError}=await admin
      .from('shops').select('id,owner_user_id').eq('id',body.shopId).maybeSingle();
    if(shopError)throw shopError;
    if(!shop)return Response.json({error:'Không tìm thấy quán.'},{status:404});

    const {error:profileError}=await admin.from('user_profiles')
      .update({approval_status:body.status,updated_at:new Date().toISOString()})
      .eq('user_id',shop.owner_user_id);
    if(profileError)throw profileError;

    await admin.from('shops').update({status:body.status,updated_at:new Date().toISOString()}).eq('id',shop.id);
    return Response.json({ok:true,status:body.status});
  }catch(e){
    return Response.json({error:e?.message||'Không cập nhật được trạng thái.'},{status:e?.status||500});
  }
}
