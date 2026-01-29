const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

exports.handler = async ({ body, headers }) => {
  const sig = headers['stripe-signature'];
  let event;

  try {
    // Você precisará pegar o "Signing Secret" no painel do Stripe em Webhooks
    // Por enquanto, vamos fazer sem validar assinatura para facilitar o teste, 
    // mas em produção o ideal é configurar o endpoint secret.
    event = JSON.parse(body);
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Só nos interessa quando o pagamento dá certo
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log("💰 Venda Stripe Aprovada:", session.id);

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);

    // 1. Pega dados da Metadata (que salvamos no passo anterior)
    const productIdsString = session.metadata.product_ids;
    const customerEmail = session.customer_details.email || session.metadata.customer_email;
    const paymentId = session.payment_intent; // ID do pagamento no Stripe

    if (!productIdsString) return { statusCode: 200, body: 'Sem produtos' };

    const productIds = productIdsString.split(',');

    // 2. Busca produtos no banco
    const { data: products } = await supabase.from('products').select('*').in('id', productIds);
    
    let linksHtml = "";

    // 3. Salva Vendas e Gera Links
    for (const product of products) {
        // Salva na tabela SALES (Assim aparece no seu Admin igual Mercado Pago!)
        await supabase.from('sales').insert({
            payment_id: "STRIPE_" + paymentId, // Prefixo para você saber que veio do Stripe
            customer_email: customerEmail,
            product_id: product.id,
            amount: product.price,
            status: 'approved'
        });

        // Gera Link
        const { data: signedUrlData } = await supabase
            .storage.from('apostilas').createSignedUrl(product.pdf_filename, 604800);

        linksHtml += `
            <div style="background-color: #fff; padding: 15px; margin-bottom: 10px; border-radius: 8px; border: 1px solid #eee;">
                <p style="margin: 0 0 10px 0; font-weight: bold; color: #555;">${product.title}</p>
                <a href="${signedUrlData.signedUrl}" style="background-color: #660066; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-size: 14px;">BAIXAR APOSTILA</a>
            </div>
        `;
    }

    // 4. Envia E-mail
    await resend.emails.send({
        from: 'Feltro Fácil <nao-responda@loja.feltrofacil.com.br>', 
        to: [customerEmail],
        reply_to: 'wilsonglopes@gmail.com',
        subject: `Suas apostilas chegaram! 🎁 (Internacional)`,
        html: `
            <div style="font-family: sans-serif; padding: 20px; color: #333; background-color: #f9f9f9;">
                <h1 style="color: #660066; text-align: center;">Pagamento Internacional Confirmado!</h1>
                <p style="text-align: center;">Obrigado pela compra. Aqui estão seus materiais:</p>
                <br>
                ${linksHtml}
            </div>
        `
    });

    return { statusCode: 200, body: 'Sucesso Stripe' };
  }

  return { statusCode: 200, body: 'Evento ignorado' };
};
