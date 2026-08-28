import { createClient } from '@supabase/supabase-js';

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizePhone(value=''){
  let digits=String(value).replace(/\D/g,'');
  if(digits.startsWith('0')) digits='84'+digits.slice(1);
  else if(!digits.startsWith('84') && digits.length===9) digits='84'+digits;
  return digits;
}

export async function POST(request){
  try{
    if(!url||!service){
      return Response.json({error:'Máy chủ chưa cấu hình đăng ký tài khoản.'},{status:500});
    }

    const body=await request.json();
    const phone=normalizePhone(body.phone);
    const optionalEmail=String(body.email||'').trim().toLowerCase()||null;
    const password=String(body.password||'');

    if(!/^84\d{9}$/.test(phone)){
      return Response.json({error:'Số điện thoại chưa hợp lệ.'},{status:400});
    }
    if(password.length<6){
      return Response.json({error:'Mật khẩu cần ít nhất 6 ký tự.'},{status:400});
    }
    if(optionalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(optionalEmail)){
      return Response.json({error:'Email chưa hợp lệ.'},{status:400});
    }

    const admin=createClient(url,service,{
      auth:{persistSession:false,autoRefreshToken:false}
    });

    const {data:existingProfile}=await admin
      .from('user_profiles')
      .select('user_id')
      .eq('phone',phone)
      .maybeSingle();

    if(existingProfile){
      return Response.json({error:'Số điện thoại này đã được đăng ký.'},{status:409});
    }

    if(optionalEmail){
      const {data:emailProfile}=await admin
        .from('user_profiles')
        .select('user_id')
        .eq('email',optionalEmail)
        .maybeSingle();
      if(emailProfile){
        return Response.json({error:'Email này đã được sử dụng.'},{status:409});
      }
    }

    // Auth ID tách khỏi SĐT. Nhờ vậy có thể đổi SĐT sau này mà không phá đăng nhập.
    // Người dùng không nhìn thấy email nội bộ này.
    const loginEmail=`u-${crypto.randomUUID()}@users.quanlyquan.local`;

    const {data:created,error:createError}=await admin.auth.admin.createUser({
      email:loginEmail,
      password,
      email_confirm:true,
      user_metadata:{
        phone,
        contact_email:optionalEmail,
        role:'owner'
      }
    });

    if(createError){
      const msg=String(createError.message||'');
      if(msg.toLowerCase().includes('already')){
        return Response.json({error:'Số điện thoại này đã được đăng ký.'},{status:409});
      }
      return Response.json({error:msg||'Không tạo được tài khoản.'},{status:400});
    }

    const {error:profileError}=await admin.from('user_profiles').insert({
      user_id:created.user.id,
      phone,
      email:optionalEmail,
      approval_status:'pending'
    });

    if(profileError){
      await admin.auth.admin.deleteUser(created.user.id);
      return Response.json({error:profileError.message},{status:400});
    }

    return Response.json({ok:true});
  }catch(e){
    return Response.json({error:e?.message||'Có lỗi khi đăng ký.'},{status:500});
  }
}
