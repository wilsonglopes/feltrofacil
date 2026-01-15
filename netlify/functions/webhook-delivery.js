const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { MercadoPagoConfig, Payment } = require('mercadopago');

exports.handler = async function(event) {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = new Payment(client);

    // O Mercado Pago manda o ID de formas diferentes. Aqui pegamos de todas.
    const queryParams = event.queryStringParameters;
    const paymentId = queryParams?.id || queryParams?.['data.id'];
    const topic = queryParams?.topic || queryParams?.type;

    // Se não for aviso de pagamento, a gente ignora para economizar processamento
    if (topic !== 'payment' && topic !== 'payment.created') {
        return { statusCode: 200, body: 'OK' };
    }

    // 1. Consultar se o pagamento foi APROVADO mesmo
    const paymentData = await payment.get({ id: paymentId });
    
    if (paymentData.status === 'approved') {
        const productId = paymentData.external_reference;
        const customerEmail = paymentData.payer.email;
        const transactionAmount = paymentData.transaction_amount;

        console.log(`Venda Aprovada! ID: ${paymentId} | Email: ${customerEmail}`);

        // 2. Verifica se já entregamos essa venda (evita mandar email duplicado)
        const { data: existingSale } = await supabase
            .from('sales')
            .select('id')
            .eq('payment_id', String(paymentId))
            .single();

        if (existingSale) {
            return { statusCode: 200, body: 'Venda já processada.' };
        }

        // 3. Pega os dados do produto para saber qual arquivo enviar
        const { data: product } = await supabase
            .from('products')
            .select('*')
            .eq('id', productId)
            .single();

        if (!product) throw new Error('Produto vendido não existe no banco.');

        // 4. Registra a venda na tabela 'sales'
        await supabase.from('sales').insert({
            payment_id: String(paymentId),
            customer_email: customerEmail,
            product_id: productId,
            amount: transactionAmount,
            status: 'approved'
        });

        // 5. Gera o Link Seguro (Válido por 7 dias)
        // O bucket precisa se chamar 'apostilas' e ser PRIVATE
        const { data: signedUrlData, error: signError } = await supabase
            .storage
            .from('apostilas')
            .createSignedUrl(product.pdf_filename, 604800);

        if (signError) throw new Error('Erro ao gerar link do PDF: ' + signError.message);

        // 6. Envia o E-mail
        await resend.emails.send({
            from: 'Feltro Fácil <loja@feltrofacil.com.br>', // Configure seu domínio no Resend!
            to: [customerEmail],
            subject: `Sua apostila chegou! 🎁 - ${product.title}`,
            html: `
                <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #f3e8f3; border-radius: 10px; background-color: #fcf7fd;">
                    <h1 style="color: #660066; text-align: center;">Obrigado pela compra!</h1>
                    <p>Olá,</p>
                    <p>Seu pagamento para a apostila <strong>${product.title}</strong> foi confirmado com sucesso.</p>
                    <p>Você pode baixar seu material clicando no botão abaixo. O link é seguro e válido por 7 dias.</p>
                    <br>
                    <div style="text-align: center;">
                        <a href="${signedUrlData.signedUrl}" style="background-color: #660066; color: white; padding: 15px 30px; text-decoration: none; border-radius: 50px; font-weight: bold; font-size: 16px; display: inline-block;">BAIXAR APOSTILA (PDF)</a>
                    </div>
                    <br><br>
                    <p style="font-size: 12px; color: #666;">Se o botão não funcionar, copie este link: ${signedUrlData.signedUrl}</p>
                    <hr style="border: 0; border-top: 1px solid #eee;">
                    <p style="font-size: 12px; text-align: center; color: #999;">Feltro Fácil - Apostilas Digitais</p>
                </div>
            `
        });

        return { statusCode: 200, body: 'Entrega realizada.' };
    }

    return { statusCode: 200, body: 'Pagamento não aprovado ainda.' };

  } catch (error) {
    console.error('Erro Webhook:', error);
    return { statusCode: 500, body: error.message };
  }
};
