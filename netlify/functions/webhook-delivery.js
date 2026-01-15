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

    // 1. Captura o ID do Pagamento
    const queryParams = event.queryStringParameters;
    let paymentId = queryParams?.id || queryParams?.['data.id'];
    
    if (!paymentId && event.body) {
        try {
            const body = JSON.parse(event.body);
            paymentId = body?.data?.id || body?.id;
        } catch(e) { console.log("Erro ao ler body", e); }
    }

    if (!paymentId) return { statusCode: 200, body: 'Sem ID.' };

    console.log(`🔎 Verificando pagamento ID: ${paymentId}`);

    // 2. Consulta o Mercado Pago
    const paymentData = await payment.get({ id: paymentId });
    console.log(`💳 Status: ${paymentData.status} | Valor: ${paymentData.transaction_amount}`);
    
    if (paymentData.status === 'approved') {
        const productId = paymentData.external_reference;
        const customerEmail = paymentData.payer.email;
        
        // 3. Verifica duplicidade
        const { data: existingSale } = await supabase
            .from('sales').select('id').eq('payment_id', String(paymentId)).maybeSingle();

        if (existingSale) {
            console.log("⚠️ Venda já existe no banco.");
            return { statusCode: 200, body: 'Duplicado.' };
        }

        // 4. Salva no Banco (COM LOG DE ERRO DETALHADO)
        console.log(`💾 Tentando salvar venda... Produto: ${productId}`);
        
        const { error: dbError } = await supabase.from('sales').insert({
            payment_id: String(paymentId),
            customer_email: customerEmail,
            product_id: productId, // Se isso for nulo ou inválido, vai dar erro
            amount: paymentData.transaction_amount,
            status: 'approved'
        });

        if (dbError) {
            console.error("❌ ERRO FATAL AO SALVAR NO BANCO:", dbError);
            throw new Error("Erro de Banco de Dados: " + dbError.message);
        }

        console.log("✅ Venda salva com sucesso!");

        // 5. Gera Link
        const { data: product } = await supabase.from('products').select('*').eq('id', productId).single();
        const { data: signedUrlData } = await supabase.storage.from('apostilas').createSignedUrl(product.pdf_filename, 604800);

        // 6. Envia E-mail (Usando seu domínio VERIFICADO)
        console.log(`📧 Tentando enviar e-mail para: ${customerEmail}`);
        
        try {
            await resend.emails.send({
                // ATENÇÃO: Tem que ser EXATAMENTE o domínio verificado
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
            console.log("✅ E-mail despachado!");
        } catch (emailError) {
            console.error("❌ ERRO AO ENVIAR E-MAIL:", emailError);
            // Não paramos o código aqui para garantir que o 'Sucesso' retorne ao MP
        }
        
        return { statusCode: 200, body: 'Sucesso' };
    }

    return { statusCode: 200, body: 'Ok' };

  } catch (error) {
    console.error('❌ ERRO CRÍTICO:', error);
    return { statusCode: 500, body: error.message };
  }
};
