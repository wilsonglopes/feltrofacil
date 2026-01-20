const { MercadoPagoConfig, Payment } = require('mercadopago');

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = new Payment(client);

    // Recebe o formData e a LISTA de IDs (cartItems)
    const { formData, cartItems } = JSON.parse(event.body);
    const userEmail = formData.payer.email;

    // Transforma a lista de IDs em uma string separada por vírgula para caber na metadata
    // Ex: "uuid1,uuid2,uuid3"
    const itemsString = cartItems.join(',');

    const paymentPayload = {
        ...formData, 
        description: `Pedido com ${cartItems.length} itens`,
        external_reference: "carrinho_multiplo", 
        notification_url: "https://loja.feltrofacil.com.br/.netlify/functions/webhook-delivery",
        metadata: {
            customer_email: userEmail,
            items_ids: itemsString // <--- O Segredo está aqui
        }
    };

    const response = await payment.create({ body: paymentPayload });

    return { statusCode: 200, headers, body: JSON.stringify(response) };

  } catch (error) {
    console.error(error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
