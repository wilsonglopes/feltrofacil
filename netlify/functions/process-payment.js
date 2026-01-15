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

    // 1. Recebe os dados que vieram do site (Dados do cartão + ID da apostila)
    const { formData, productId } = JSON.parse(event.body);

    // 2. Monta o pacote de pagamento
    // AQUI ESTÁ O SEGREDO: Adicionamos o 'notification_url' aqui!
    const paymentPayload = {
        ...formData, 
        external_reference: productId, // ID para sabermos qual apostila entregar
        notification_url: "https://feltrofacil.netlify.app/.netlify/functions/webhook-delivery" // O Link que deu OK
    };

    console.log("Processando pagamento transparente para:", productId);

    // 3. Envia para o Mercado Pago
    const response = await payment.create({ body: paymentPayload });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Erro ao processar pagamento:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Erro no processamento' }),
    };
  }
};
