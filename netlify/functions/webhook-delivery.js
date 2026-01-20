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

    // 1. Captura ID
    const queryParams = event.queryStringParameters;
    let paymentId = queryParams?.id || queryParams?.['data.id'];
    if (!paymentId && event.body) {
        try { const body = JSON.parse(event.body); paymentId = body?.data?.id || body?.id; } catch(e) {}
    }
    
    if (!paymentId) return { statusCode: 200, body: 'Sem ID.' };

    // 2. Consulta Status no Mercado Pago
    // Consultamos o MP antes de travar, para não encher o banco com travas de pagamentos pendentes
    const paymentData = await payment.get({ id: paymentId });
    console.log(`💳 Status do ID ${paymentId}: ${paymentData.status}`);
    
    // SÓ processa se for Aprovado
    if (paymentData.status === 'approved') {
        
        // --- AQUI ESTÁ A CORREÇÃO (TRAVA MESTRA) ---
        // Tenta registrar que estamos processando este ID.
        // Se já existir na tabela 'processed_webhooks', vai dar erro e paramos aqui.
        const { error: lockError } = await supabase
            .from('processed_webhooks')
            .insert({ payment_id: String(paymentId) });

        if (lockError) {
            console.log(`🛑 Pagamento ${paymentId} já foi processado (Trava ativa). Ignorando duplicata.`);
            return { statusCode: 200, body: 'Duplicata ignorada.' };
        }
        // -------------------------------------------

        const customerEmail = paymentData.metadata?.customer_email || paymentData.payer.email;
        const itemsIdsString = paymentData.metadata?.items_ids; 
        
        // Garante a lista de produtos
        const productIds = itemsIdsString ? itemsIdsString.split(',') : [paymentData.external_reference];

        console.log(`📦 Processando ${productIds.length} itens para: ${customerEmail}`);

        // 3. Busca produtos
        const { data: products } = await supabase
            .from('products')
            .select('*')
            .in('id', productIds);

        if (!products || products.length === 0) return { statusCode: 200, body: 'Produtos não encontrados.' };

        let linksHtml = "";
        
        // 4. Salva as vendas e Gera Links
        for (const product of products) {
            // Salva na tabela sales (para o Admin ver)
            // Usamos 'upsert' ou ignoramos erro se já existir, pois a trava já garantiu o e-mail único
            await supabase.from('sales').insert({
                payment_id: String(paymentId),
                customer_email: customerEmail,
                product_id: product.id,
                amount: product.price,
                status: 'approved'
            }).catch(err => console.log("Item já salvo, prosseguindo..."));

            // Gera Link
            const { data: signedUrlData } = await supabase
                .storage.from('apostilas').createSignedUrl(product.pdf_filename, 604800);

            linksHtml += `
                <div style="background-color: #fff; padding: 15px; margin-bottom: 10px; border-radius: 8px; border: 1px solid #eee;">
                    <p style="margin: 0 0 10px 0; font-weight: bold; color: #555;">${product.title}</p>
                    <a href="${signedUrlData.signedUrl}" style="background-color: #660066; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-size: 14px;">BAIXAR ESTA APOSTILA</a>
                </div>
            `;
        }

        // 5. Envia o E-mail (GARANTIDO SER O ÚNICO)
        console.log(`📧 Enviando e-mail ÚNICO...`);

        await resend.emails.send({
            from: 'Feltro Fácil <nao-responda@loja.feltrofacil.com.br>', 
            to: [customerEmail],
            reply_to: 'wilsonglopes@gmail.com',
            subject: `Suas apostilas chegaram! 🎁 (${products.length} itens)`,
            html: `
                <div style="font-family: sans-serif; padding: 20px; color: #333; background-color: #f9f9f9;">
                    <h1 style="color: #660066; text-align: center;">Pagamento Aprovado!</h1>
                    <p style="text-align: center;">Obrigado por comprar conosco. Aqui estão seus materiais:</p>
                    <br>
                    ${linksHtml}
                    <br><br>
                    <p style="font-size: 12px; color: #777; text-align: center;">Links válidos por 7 dias.</p>
                </div>
            `
        });
        
        return { statusCode: 200, body: 'Sucesso' };
    }

    return { statusCode: 200, body: 'Ok - Status não aprovado' };

  } catch (error) {
    console.error('ERRO:', error);
    return { statusCode: 500, body: error.message };
  }
};
