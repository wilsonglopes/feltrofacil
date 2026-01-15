const { MercadoPagoConfig, Payment } = require('mercadopago');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    if (!process.env.MP_ACCESS_TOKEN) throw new Error('MP_ACCESS_TOKEN ausente.');

    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = new Payment(client);

    const { formData, productId } = JSON.parse(event.body);

    // SEGURANÇA: Garante que pegamos o e-mail que o cliente digitou
    const userEmail = formData.payer.email;

    const paymentPayload = {
        ...formData, 
        external_reference: productId,
        notification_url: "https://loja.feltrofacil.com.br/.netlify/functions/webhook-delivery",
        // AQUI ESTÁ A CORREÇÃO 👇
        // Guardamos o e-mail na metadata para ele não virar XXXXXXXXX depois
        metadata: {
            customer_email: userEmail,
            product_id: productId
        }
    };

    console.log("Iniciando pagamento para:", userEmail);

    const response = await payment.create({ body: paymentPayload });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Erro ao processar:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
