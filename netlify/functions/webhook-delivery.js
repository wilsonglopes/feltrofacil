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
    const paymentData = await payment.get({ id: paymentId });
    console.log(`💳 Status do ID ${paymentId}: ${paymentData.status}`);
    
    if (paymentData.status === 'approved') {
        
        // --- TRAVA DE SEGURANÇA INTELIGENTE 2.0 ---
        // Tenta criar a trava
        const { error: lockError } = await supabase
            .from('processed_webhooks')
            .insert({ payment_id: String(paymentId) });

        if (lockError) {
            // Se deu erro porque já existe a trava, vamos verificar se foi um "Zumbi"
            console.log(`⚠️ Trava encontrada para ${paymentId}. Verificando se é real...`);
            
            // Pergunta: "Tem venda salva para esse ID?"
            const { data: existingSales } = await supabase
                .from('sales')
                .select('id')
                .eq('payment_id', String(paymentId));

            // Se JÁ TEM venda salva, aí sim é duplicidade real. Paramos.
            if (existingSales && existingSales.length > 0) {
                console.log(`🛑 Vendas já confirmadas. Parando para evitar e-mail duplo.`);
                return { statusCode: 200, body: 'Duplicata real confirmada.' };
            }

            // Se NÃO TEM venda, a trava é falsa (o código morreu antes de salvar). CONTINUAMOS!
            console.log(`🧟 Trava Zumbi detectada! (Trava existe mas Vendas não). Processando...`);
        }
        // -------------------------------------------

        const customerEmail = paymentData.metadata?.customer_email || paymentData.payer.email;
        const itemsIdsString = paymentData.metadata?.items_ids; 
        
        // Garante a lista de produtos (Fallback para external_reference)
        let productIds = [];
        if (itemsIdsString) {
            productIds = itemsIdsString.split(',');
        } else if (paymentData.external_reference && paymentData.external_reference !== "carrinho_multiplo") {
            productIds = [paymentData.external_reference];
        }

        if (productIds.length === 0) {
             console.error("❌ Nenhum produto identificado na venda.");
             return { statusCode: 200, body: 'Erro: Sem produtos.' };
        }

        console.log(`📦 Processando itens: ${productIds.join(', ')} para ${customerEmail}`);

        // 3. Busca produtos
        const { data: products } = await supabase
            .from('products')
            .select('*')
            .in('id', productIds);

        if (!products || products.length === 0) return { statusCode: 200, body: 'Produtos não encontrados.' };

        let linksHtml = "";
        
        // 4. Salva as vendas e Gera Links
        for (const product of products) {
            // Insere a venda
            const { error: insertError } = await supabase.from('sales').insert({
                payment_id: String(paymentId),
                customer_email: customerEmail,
                product_id: product.id,
                amount: product.price,
                status: 'approved'
            });

            if (insertError) console.log(`Nota: Erro ao salvar venda (pode já existir): ${insertError.message}`);

            // Gera o Link
            const { data: signedUrlData } = await supabase
                .storage.from('apostilas').createSignedUrl(product.pdf_filename, 604800);

            linksHtml += `
                <div style="background-color: #fff; padding: 15px; margin-bottom: 10px; border-radius: 8px; border: 1px solid #eee;">
                    <p style="margin: 0 0 10px 0; font-weight: bold; color: #555;">${product.title}</p>
                    <a href="${signedUrlData.signedUrl}" style="background-color: #660066; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-size: 14px;">BAIXAR APOSTILA</a>
                </div>
            `;
        }

        // 5. Envia o E-mail
        console.log(`📧 Enviando e-mail...`);
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
        
        console.log("✅ Sucesso Total.");
        return { statusCode: 200, body: 'Sucesso' };
    }

    return { statusCode: 200, body: 'Ok' };

  } catch (error) {
    console.error('❌ ERRO:', error);
    return { statusCode: 500, body: error.message };
  }
};
