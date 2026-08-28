import { createClient } from '@supabase/supabase-js';

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizePhone(value=''){
  let digits=String(value).replace(/\D/g,'');
  if(digits.startsWith('0')) digits='84'+digits.slice(1);
  else if(!digits.startsWith('84') && digits.length===9) digits='84'+digits;
  return digits;
}

export async function POST(request){
  try{
    if(!url||!anon||!service)return Response.json({error:'Máy chủ chưa cấu hình đăng nhập.'},{status:500});

    const body=await request.json();
    const phone=normalizePhone(body.phone);
    const password=String(body.password||'');

    if(!/^84\d{9}$/.test(phone)||!password){
      return Response.json({error:'Sai số điện thoại hoặc mật khẩu.'},{status:400});
    }

    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:profile,error:profileError}=await admin
      .from('user_profiles')
      .select('user_id,approval_status')
      .eq('phone',phone)
      .maybeSingle();

    if(profileError||!profile){
      return Response.json({error:'Sai số điện thoại hoặc mật khẩu.'},{status:401});
    }

    const approval=profile.approval_status||'approved';
    if(approval==='pending')return Response.json({error:'Tài khoản đang chờ Admin xét duyệt.',status:'pending'},{status:403});
    if(approval==='rejected')return Response.json({error:'Quán không được duyệt.',status:'rejected'},{status:403});
    if(approval==='suspended')return Response.json({error:'Quán đang tạm ngưng.',status:'suspended'},{status:403});
    if(approval==='locked')return Response.json({error:'Tài khoản đã bị khóa.',status:'locked'},{status:403});

    const {data:userData,error:userError}=await admin.auth.admin.getUserById(profile.user_id);
    const authEmail=userData?.user?.email;
    if(userError||!authEmail){
      return Response.json({error:'Sai số điện thoại hoặc mật khẩu.'},{status:401});
    }

    const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.auth.signInWithPassword({email:authEmail,password});
    if(error||!data?.session){
      return Response.json({error:'Sai số điện thoại hoặc mật khẩu.'},{status:401});
    }

    return Response.json({
      access_token:data.session.access_token,
      refresh_token:data.session.refresh_token
    });
  }catch(e){
    return Response.json({error:'Không đăng nhập được. Vui lòng thử lại.'},{status:500});
  }
}
