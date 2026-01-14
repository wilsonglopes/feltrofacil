const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { MercadoPagoConfig, Payment } = require('mercadopago');

exports.handler = async function(event) {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = new Payment(client);

    // O Mercado Pago envia o ID de formas diferentes dependendo da notificação
    const queryParams = event.queryStringParameters;
    const paymentId = queryParams?.id || queryParams?.['data.id'];
    const topic = queryParams?.topic || queryParams?.type;

    // Se não for notificação de pagamento, ignora
    if (topic !== 'payment' && topic !== 'payment.created') {
        return { statusCode: 200, body: 'OK (Topic ignored)' };
    }

    // 1. Consultar status do pagamento no Mercado Pago
    const paymentData = await payment.get({ id: paymentId });
    
    // Apenas continuamos se estiver APROVADO
    if (paymentData.status === 'approved') {
        const productId = paymentData.external_reference;
        const customerEmail = paymentData.payer.email;
        const transactionAmount = paymentData.transaction_amount;

        console.log(`Pagamento ${paymentId} aprovado. Cliente: ${customerEmail}. Produto: ${productId}`);

        // 2. Verificar se já entregamos este pedido (evitar envios duplicados)
        const { data: existingSale } = await supabase
            .from('sales')
            .select('id')
            .eq('payment_id', String(paymentId))
            .single();

        if (existingSale) {
            return { statusCode: 200, body: 'Venda já processada anteriormente.' };
        }

        // 3. Buscar informações do produto (para pegar o nome do arquivo PDF)
        const { data: product } = await supabase
            .from('products')
            .select('*')
            .eq('id', productId)
            .single();

        if (!product) throw new Error('Produto não encontrado no banco.');

        // 4. Registrar a venda
        await supabase.from('sales').insert({
            payment_id: String(paymentId),
            customer_email: customerEmail,
            product_id: productId,
            amount: transactionAmount,
            status: 'approved'
        });

        // 5. Gerar Link Assinado (Válido por 7 dias)
        // ATENÇÃO: Seu bucket deve se chamar 'apostilas' e ser PRIVADO
        const { data: signedUrlData, error: signError } = await supabase
            .storage
            .from('apostilas')
            .createSignedUrl(product.pdf_filename, 604800); // 604800 segundos = 7 dias

        if (signError) throw new Error('Erro ao gerar link do PDF: ' + signError.message);

        // 6. Enviar E-mail
        await resend.emails.send({
            from: 'Feltro Fácil <loja@feltrofacil.com.br>', // Certifique-se que este domínio está verificado no Resend
            to: [customerEmail],
            subject: `Sua apostila chegou! 🎁 - ${product.title}`,
            html: `
                <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h1 style="color: #db2777; text-align: center;">Obrigado pela compra!</h1>
                    <p>Olá,</p>
                    <p>Seu pagamento para a apostila <strong>${product.title}</strong> foi confirmado com sucesso.</p>
                    <p>Você pode baixar seu material clicando no botão abaixo. O link é seguro e válido por 7 dias.</p>
                    <br>
                    <div style="text-align: center;">
                        <a href="${signedUrlData.signedUrl}" style="background-color: #db2777; color: white; padding: 15px 30px; text-decoration: none; border-radius: 50px; font-weight: bold; font-size: 16px; display: inline-block;">BAIXAR APOSTILA (PDF)</a>
                    </div>
                    <br><br>
                    <p style="font-size: 12px; color: #666;">Se tiver qualquer problema, responda a este e-mail.</p>
                    <hr style="border: 0; border-top: 1px solid #eee;">
                    <p style="font-size: 12px; text-align: center; color: #999;">Feltro Fácil - Apostilas Digitais</p>
                </div>
            `
        });

        return { statusCode: 200, body: 'Entrega realizada com sucesso.' };
    }

    return { statusCode: 200, body: 'Status não é aprovado ainda.' };

  } catch (error) {
    console.error('Erro Fatal no Webhook:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
