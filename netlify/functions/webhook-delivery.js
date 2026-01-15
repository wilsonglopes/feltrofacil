const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { MercadoPagoConfig, Payment } = require('mercadopago');

exports.handler = async function(event) {
  console.log("🔔 WEBHOOK INICIADO!"); 
  
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = new Payment(client);

    const queryParams = event.queryStringParameters;
    let paymentId = queryParams?.id || queryParams?.['data.id'];
    
    if (!paymentId && event.body) {
        try {
            const body = JSON.parse(event.body);
            paymentId = body?.data?.id || body?.id;
        } catch(e) {}
    }

    if (!paymentId) return { statusCode: 200, body: 'Sem ID.' };

    // Consulta o Mercado Pago
    const paymentData = await payment.get({ id: paymentId });
    console.log(`💳 Status: ${paymentData.status}`);
    
    if (paymentData.status === 'approved') {
        const productId = paymentData.external_reference;
        
        // A CORREÇÃO MÁGICA 👇
        // Tenta pegar o e-mail da nossa "mochila" (metadata). 
        // Se não tiver lá, tenta o padrão (mas agora preferimos o metadata).
        const customerEmail = paymentData.metadata?.customer_email || paymentData.payer.email;
        
        console.log(`📧 E-mail identificado: ${customerEmail}`);

        if (customerEmail.includes("XXX")) {
            console.error("❌ ERRO FATAL: O e-mail ainda está mascarado. Verifique o process-payment.js");
            // Não vamos nem tentar salvar para não sujar o banco
            return { statusCode: 200, body: 'Erro de Email Mascarado' };
        }

        // Verifica duplicidade
        const { data: existingSale } = await supabase
            .from('sales').select('id').eq('payment_id', String(paymentId)).maybeSingle();

        if (existingSale) return { statusCode: 200, body: 'Duplicado.' };

        // Salva no Banco
        await supabase.from('sales').insert({
            payment_id: String(paymentId),
            customer_email: customerEmail, // Agora vai o e-mail certo!
            product_id: productId,
            amount: paymentData.transaction_amount,
            status: 'approved'
        });

        // Gera Link e Envia E-mail
        const { data: product } = await supabase.from('products').select('*').eq('id', productId).single();
        const { data: signedUrlData } = await supabase.storage.from('apostilas').createSignedUrl(product.pdf_filename, 604800);

        await resend.emails.send({
            from: 'Feltro Fácil <nao-responda@loja.feltrofacil.com.br>', 
            to: [customerEmail],
            reply_to: 'wilsonglopes@gmail.com',
            subject: `Sua apostila chegou! 🎁 - ${product.title}`,
            html: `
                <div style="font-family: sans-serif; padding: 20px; color: #333;">
                    <h1 style="color: #660066;">Pagamento Aprovado!</h1>
                    <p>Olá! Sua apostila <strong>${product.title}</strong> já está disponível.</p>
                    <br>
                    <a href="${signedUrlData.signedUrl}" style="background-color: #660066; color: white; padding: 15px 25px; text-decoration: none; border-radius: 5px;">BAIXAR AGORA</a>
                    <br><br>
                    <p style="font-size: 12px; color: #777;">Não responda este e-mail. Dúvidas? Escreva para wilsonglopes@gmail.com</p>
                </div>
            `
        });
        
        console.log("✅ Sucesso total!");
        return { statusCode: 200, body: 'Sucesso' };
    }

    return { statusCode: 200, body: 'Ok' };

  } catch (error) {
    console.error('ERRO:', error);
    return { statusCode: 500, body: error.message };
  }
};
