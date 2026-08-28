import { createClient } from '@supabase/supabase-js';

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request){
  try{
    if(!url||!anon||!service)return Response.json({error:'Chưa cấu hình khóa tạo tài khoản nhân viên.'},{status:500});

    const auth=request.headers.get('authorization')||'';
    const token=auth.startsWith('Bearer ')?auth.slice(7):'';
    if(!token)return Response.json({error:'Thiếu phiên chủ quán.'},{status:401});

    const userClient=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
    const {data:userData,error:userError}=await userClient.auth.getUser(token);
    if(userError||!userData?.user)return Response.json({error:'Phiên đăng nhập không hợp lệ.'},{status:401});

    const body=await request.json();
    const shopId=String(body.shopId||'').trim();
    const username=String(body.username||'').trim().toLowerCase();
    const password=String(body.password||'');
    const displayName=String(body.displayName||username).trim();

    if(!shopId||!username||password.length<6)return Response.json({error:'Thông tin tài khoản chưa hợp lệ.'},{status:400});
    if(!/^[a-z0-9._-]+$/.test(username))return Response.json({error:'Tên đăng nhập không hợp lệ.'},{status:400});

    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});

    // Chỉ owner của đúng shop mới được tạo nhân viên.
    const {data:shop,error:shopError}=await admin.from('shops')
      .select('id,code,owner_user_id,status')
      .eq('id',shopId)
      .maybeSingle();

    if(shopError||!shop)return Response.json({error:'Không tìm thấy quán.'},{status:404});
    if(shop.owner_user_id!==userData.user.id)return Response.json({error:'Bạn không phải chủ quán này.'},{status:403});
    if(shop.status!=='active')return Response.json({error:'Quán đang tạm ngưng.'},{status:400});

    const {data:duplicate}=await admin.from('shop_members')
      .select('member_user_id')
      .eq('shop_id',shopId)
      .eq('username',username)
      .maybeSingle();
    if(duplicate)return Response.json({error:'Tên đăng nhập đã tồn tại trong quán.'},{status:400});

    const code=String(shop.code||'').toLowerCase();
    const email=`${code}.${username}@staff.quanlyquan.local`;

    const {data:created,error:createError}=await admin.auth.admin.createUser({
      email,password,email_confirm:true,
      user_metadata:{display_name:displayName,role:'employee',shop_id:shopId,shop_code:shop.code}
    });

    if(createError)return Response.json({error:createError.message?.toLowerCase().includes('already')?'Tên đăng nhập đã tồn tại.':createError.message},{status:400});

    const {error:memberError}=await admin.from('shop_members').insert({
      member_user_id:created.user.id,
      owner_user_id:userData.user.id,
      shop_id:shopId,
      username,
      display_name:displayName,
      role:'employee',
      active:true
    });

    if(memberError){
      await admin.auth.admin.deleteUser(created.user.id);
      return Response.json({error:memberError.message},{status:400});
    }

    return Response.json({ok:true,shopCode:shop.code,username});
  }catch(e){
    return Response.json({error:e?.message||'Có lỗi khi tạo tài khoản.'},{status:500});
  }
}
