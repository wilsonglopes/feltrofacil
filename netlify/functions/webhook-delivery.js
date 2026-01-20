const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { MercadoPagoConfig, Payment } = require('mercadopago');

exports.handler = async function(event) {
  console.log("🔔 WEBHOOK CARRINHO INICIADO!"); 
  
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

    // 2. Consulta Status
    const paymentData = await payment.get({ id: paymentId });
    
    if (paymentData.status === 'approved') {
        const customerEmail = paymentData.metadata?.customer_email || paymentData.payer.email;
        // Pega a lista de IDs da metadata
        const itemsIdsString = paymentData.metadata?.items_ids; 
        
        // Se não tiver lista (compra antiga), tenta pegar do external_reference (legado)
        const productIds = itemsIdsString ? itemsIdsString.split(',') : [paymentData.external_reference];

        console.log(`📦 Processando ${productIds.length} itens para: ${customerEmail}`);

        // 3. Busca detalhes de TODOS os produtos
        const { data: products } = await supabase
            .from('products')
            .select('*')
            .in('id', productIds);

        if (!products || products.length === 0) return { statusCode: 200, body: 'Produtos não encontrados.' };

        // 4. Prepara links e HTML do e-mail
        let linksHtml = "";
        
        // Loop para processar cada produto
        for (const product of products) {
            
            // Salva a venda individualmente no banco (para aparecer no Admin)
            // O try/catch aqui evita que o erro de duplicidade trave o resto
            try {
                await supabase.from('sales').insert({
                    payment_id: String(paymentId),
                    customer_email: customerEmail,
                    product_id: product.id,
                    amount: product.price, // Salva o preço individual
                    status: 'approved'
                });
            } catch (dbError) {
                console.log(`⚠️ Venda do produto ${product.title} já registrada ou erro de banco.`);
            }

            // Gera o Link
            const { data: signedUrlData } = await supabase
                .storage.from('apostilas').createSignedUrl(product.pdf_filename, 604800);

            // Adiciona na lista do e-mail
            linksHtml += `
                <div style="background-color: #fff; padding: 15px; margin-bottom: 10px; border-radius: 8px; border: 1px solid #eee;">
                    <p style="margin: 0 0 10px 0; font-weight: bold; color: #555;">${product.title}</p>
                    <a href="${signedUrlData.signedUrl}" style="background-color: #660066; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-size: 14px;">BAIXAR ESTA APOSTILA</a>
                </div>
            `;
        }

        // 5. Envia UM e-mail com TUDO
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

    return { statusCode: 200, body: 'Ok' };

  } catch (error) {
    console.error('ERRO:', error);
    return { statusCode: 500, body: error.message };
  }
};
