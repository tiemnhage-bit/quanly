import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'crypto';

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizePhone(value=''){
  let digits=String(value).replace(/\D/g,'');
  if(digits.startsWith('0')) digits='84'+digits.slice(1);
  else if(!digits.startsWith('84') && digits.length===9) digits='84'+digits;
  return digits;
}

const STARTER_MENUS={
  cafe:[
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
  ],
  fruit:[
    ['Trái cây phần','Dưa hấu cắt sẵn',25000],['Trái cây phần','Thơm cắt sẵn',25000],['Trái cây phần','Ổi cắt sẵn',25000],
    ['Trái cây phần','Xoài cắt sẵn',30000],['Trái cây phần','Cóc cắt sẵn',25000],['Trái cây phần','Thanh long cắt sẵn',30000],
    ['Trái cây mix','Tô trái cây mix nhỏ',35000],['Trái cây mix','Tô trái cây mix lớn',50000],
    ['Trái cây mix','Combo trái cây 2 người',69000],['Trái cây mix','Combo trái cây gia đình',119000],
    ['Ăn kèm','Muối tôm',5000],['Ăn kèm','Muối ớt',5000],['Ăn kèm','Sốt chấm trái cây',7000],
    ['Nước ép','Nước ép dưa hấu',30000],['Nước ép','Nước ép thơm',35000],['Nước ép','Nước ép cam',35000],['Nước ép','Nước ép cà rốt',30000]
  ],
  noodles:[
    ['Phở','Phở bò tái',45000],['Phở','Phở bò chín',45000],['Phở','Phở tái nạm',50000],['Phở','Phở đặc biệt',60000],
    ['Bún','Bún bò',45000],['Bún','Bún bò đặc biệt',55000],['Bún','Bún thịt nướng',45000],['Bún','Bún chả giò',40000],
    ['Món thêm','Thêm thịt',20000],['Món thêm','Thêm bò viên',15000],['Món thêm','Thêm chả',10000],
    ['Món thêm','Thêm bún/phở',10000],['Món thêm','Quẩy',5000],
    ['Nước uống','Trà đá',3000],['Nước uống','Nước suối',10000],['Nước uống','Nước ngọt',15000]
  ],
  rice:[
    ['Cơm phần','Cơm sườn',40000],['Cơm phần','Cơm sườn bì',45000],['Cơm phần','Cơm sườn bì chả',50000],
    ['Cơm phần','Cơm gà chiên',40000],['Cơm phần','Cơm gà xối mỡ',45000],['Cơm phần','Cơm thịt kho trứng',40000],
    ['Cơm phần','Cơm cá kho',40000],['Cơm phần','Cơm bò xào',50000],['Cơm phần','Cơm phần đặc biệt',55000],
    ['Món thêm','Thêm cơm',7000],['Món thêm','Thêm trứng ốp la',8000],['Món thêm','Thêm sườn',25000],
    ['Món thêm','Thêm chả',10000],['Món thêm','Canh thêm',7000],
    ['Nước uống','Trà đá',3000],['Nước uống','Nước suối',10000],['Nước uống','Nước ngọt',15000]
  ]
};

const LABELS={cafe:'Cà phê & nước',fruit:'Trái cây cắt sẵn',noodles:'Bún / Phở',rice:'Quán cơm'};

function starterProducts(key){
  return (STARTER_MENUS[key]||[]).map((row,i)=>({
    id:`starter-${key}-${i+1}`,
    category:row[0],name:row[1],price:row[2],cost:0,active:true,recipe:[]
  }));
}

async function uniqueCode(admin){
  for(let i=0;i<20;i++){
    const code=randomBytes(3).toString('hex').toUpperCase();
    const {data}=await admin.from('shops').select('id').eq('code',code).maybeSingle();
    if(!data)return code;
  }
  throw new Error('Không tạo được mã quán.');
}

export async function POST(request){
  let createdUserId=null;
  try{
    if(!url||!service)return Response.json({error:'Máy chủ chưa cấu hình đăng ký tài khoản.'},{status:500});

    const body=await request.json();
    const phone=normalizePhone(body.phone);
    const optionalEmail=String(body.email||'').trim().toLowerCase()||null;
    const password=String(body.password||'');
    const shopName=String(body.shopName||'').trim();
    const shopAddress=String(body.shopAddress||'').trim()||null;
    const menuPreset=String(body.menuPreset||'cafe');

    if(!/^84\d{9}$/.test(phone))return Response.json({error:'Số điện thoại chưa hợp lệ.'},{status:400});
    if(password.length<6)return Response.json({error:'Mật khẩu cần ít nhất 6 ký tự.'},{status:400});
    if(!shopName)return Response.json({error:'Vui lòng nhập tên quán.'},{status:400});
    if(!STARTER_MENUS[menuPreset])return Response.json({error:'Loại hình quán chưa hợp lệ.'},{status:400});
    if(optionalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(optionalEmail))return Response.json({error:'Email chưa hợp lệ.'},{status:400});

    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});

    const {data:existing}=await admin.from('user_profiles').select('user_id').eq('phone',phone).maybeSingle();
    if(existing)return Response.json({error:'Số điện thoại này đã được đăng ký.'},{status:409});

    if(optionalEmail){
      const {data:emailProfile}=await admin.from('user_profiles').select('user_id').eq('email',optionalEmail).maybeSingle();
      if(emailProfile)return Response.json({error:'Email này đã được sử dụng.'},{status:409});
    }

    const loginEmail=`u-${randomUUID()}@users.quanlyquan.local`;
    const {data:created,error:createError}=await admin.auth.admin.createUser({
      email:loginEmail,password,email_confirm:true,
      user_metadata:{phone,contact_email:optionalEmail,role:'owner'}
    });
    if(createError)return Response.json({error:createError.message||'Không tạo được tài khoản.'},{status:400});
    createdUserId=created.user.id;

    const {error:profileError}=await admin.from('user_profiles').insert({
      user_id:createdUserId,phone,email:optionalEmail,approval_status:'pending'
    });
    if(profileError)throw profileError;

    const code=await uniqueCode(admin);
    const {data:shop,error:shopError}=await admin.from('shops').insert({
      code,
      name:shopName,
      address:shopAddress,
      owner_user_id:createdUserId,
      plan:'free',
      status:'pending',
      business_type:LABELS[menuPreset]||menuPreset,
      menu_preset:menuPreset
    }).select('id').single();
    if(shopError)throw shopError;

    const {error:stateError}=await admin.from('app_states').insert({
      user_id:createdUserId,
      shop_id:shop.id,
      products:starterProducts(menuPreset),
      product_categories:[...new Set((STARTER_MENUS[menuPreset]||[]).map(row=>row[0]).filter(Boolean))],
      orders:[],
      ingredients:[],
      stock_receipts:[],
      stock_counts:[],
      stock_adjustments:[],
      cash_transactions:[],
      expense_categories:["Nhân viên","Mặt bằng","Điện nước","Quảng cáo","Vận chuyển","Sửa chữa","Phần mềm","Khác"],
      opening_balances:{cash:0,bank:0},
      day_closings:[],
      updated_at:new Date().toISOString()
    });
    if(stateError)throw stateError;

    return Response.json({ok:true,status:'pending'});
  }catch(e){
    if(createdUserId){
      try{
        const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
        await admin.auth.admin.deleteUser(createdUserId);
      }catch{}
    }
    return Response.json({error:e?.message||'Có lỗi khi đăng ký.'},{status:500});
  }
}
