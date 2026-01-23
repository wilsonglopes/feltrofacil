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
        try { const body = JSON.parse(event.body); paymentId = body?.data?.id || body?.id; } catch(e) {}
    }
    
    if (!paymentId) return { statusCode: 200, body: 'Sem ID.' };

    const paymentData = await payment.get({ id: paymentId });
    
    if (paymentData.status === 'approved') {
        
        // --- TRAVA DE TEMPO (TIME LOCK) ---
        // 1. Tenta inserir a trava
        const { error: lockError } = await supabase
            .from('processed_webhooks')
            .insert({ payment_id: String(paymentId) });

        if (lockError) {
            // Se já existe, vamos ver QUANDO foi criada
            const { data: existingLock } = await supabase
                .from('processed_webhooks')
                .select('created_at')
                .eq('payment_id', String(paymentId))
                .maybeSingle();

            if (existingLock) {
                const lockTime = new Date(existingLock.created_at).getTime();
                const now = new Date().getTime();
                const diffMinutes = (now - lockTime) / 1000 / 60;

                // Se a trava tem menos de 5 minutos, o outro processo ainda está rodando.
                // NÃO MEXA!
                if (diffMinutes < 5) {
                    console.log(`🛑 Trava RECENTE (${diffMinutes.toFixed(1)} min). Outro processo em andamento. Parando.`);
                    return { statusCode: 200, body: 'Duplicata evitada.' };
                }
                
                // Se a trava é velha (> 5 min), aí sim assumimos que o anterior falhou (Zumbi).
                console.log(`🧟 Trava ANTIGA detectada (${diffMinutes.toFixed(1)} min). Retomando processo...`);
            } else {
                // Caso raro onde dá erro de insert mas não consegue ler a trava
                console.log("⚠️ Erro na trava estranho, mas vamos seguir para garantir entrega.");
            }
        }
        // -----------------------------------

        const customerEmail = paymentData.metadata?.customer_email || paymentData.payer.email;
        const itemsIdsString = paymentData.metadata?.items_ids; 
        
        let productIds = [];
        if (itemsIdsString) {
            productIds = itemsIdsString.split(',');
        } else if (paymentData.external_reference && paymentData.external_reference !== "carrinho_multiplo") {
            productIds = [paymentData.external_reference];
        }

        if (productIds.length === 0) return { statusCode: 200, body: 'Sem produtos.' };

        console.log(`📦 Processando itens: ${productIds.join(', ')}`);

        const { data: products } = await supabase
            .from('products')
            .select('*')
            .in('id', productIds);

        if (!products || products.length === 0) return { statusCode: 200, body: 'Produtos não encontrados.' };

        let linksHtml = "";
        
        for (const product of products) {
            await supabase.from('sales').insert({
                payment_id: String(paymentId),
                customer_email: customerEmail,
                product_id: product.id,
                amount: product.price,
                status: 'approved'
            }).catch(err => console.log(`Venda já existe (ok): ${err.message}`));

            const { data: signedUrlData } = await supabase
                .storage.from('apostilas').createSignedUrl(product.pdf_filename, 604800);

            linksHtml += `
                <div style="background-color: #fff; padding: 15px; margin-bottom: 10px; border-radius: 8px; border: 1px solid #eee;">
                    <p style="margin: 0 0 10px 0; font-weight: bold; color: #555;">${product.title}</p>
                    <a href="${signedUrlData.signedUrl}" style="background-color: #660066; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-size: 14px;">BAIXAR APOSTILA</a>
                </div>
            `;
        }

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
        
        return { statusCode: 200, body: 'Sucesso' };
    }

    return { statusCode: 200, body: 'Ok' };

  } catch (error) {
    console.error('ERRO:', error);
    return { statusCode: 500, body: error.message };
  }
};
