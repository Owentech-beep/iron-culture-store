const business = {
  name: "IRON CULTURE SUBS (PTY)LTD",
  registration: "K2026/099278/07",
  address: "28 Kerk Street, Ficksburg, 9730, South Africa",
  email: "jp.grobler23@gmail.com",
  phone: "078 176 3835",
};

const businessSection = {
  heading: "Business Information",
  paragraphs: [
    `${business.name}, trading as Iron Culture Supplements.`,
    `Company registration number: ${business.registration}.`,
    `Business address and address for legal notices: ${business.address}.`,
    `Email: ${business.email}. Telephone: ${business.phone}.`,
    "Website: https://ironculturesubs.co.za.",
  ],
};

function policy(title, introduction, sections) {
  return {
    title,
    updatedAt: "2026-11-03",
    updatedLabel: "3 November 2026",
    introduction,
    sections: [businessSection, ...sections],
  };
}

export const storePolicies = {
  terms: policy(
    "Terms & Conditions",
    "These terms explain how customers may use our online store and purchase products.",
    [
      {
        heading: "Products and Orders",
        paragraphs: [
          "Review the product, selected size or flavour, quantity, delivery address and total before submitting your order.",
          "Product availability may change. Submitting an unpaid order does not confirm payment or guarantee fulfilment.",
          "If we cannot supply a paid item, we will contact you to arrange an appropriate refund or an alternative that you agree to.",
        ],
      },
      {
        heading: "Prices and Payment",
        paragraphs: [
          "Prices are displayed in South African rand. Review the final order total, including delivery and discounts, before proceeding to payment.",
          "Available payment methods are shown at checkout. Payment is completed through the selected payment provider.",
          "Returning from a payment provider does not itself confirm payment. Your order is updated after payment confirmation is verified.",
          "Never send us your banking password, PIN or one-time password.",
        ],
      },
      {
        heading: "Delivery and Returns",
        paragraphs: [
          "Delivery charges and dispatch information are set out in our Shipping Policy.",
          "Our Returns Policy and Refund & Cancellation Policy explain how to report problems, cancel eligible purchases and request refunds.",
          "These policies do not exclude rights provided by applicable South African consumer law.",
        ],
      },
      {
        heading: "Product Information",
        paragraphs: [
          "Read the manufacturer's label, ingredients, allergen information and usage instructions before using a product.",
          "Website descriptions are general product information and are not individual medical advice.",
        ],
      },
      {
        heading: "Accounts and Order Records",
        paragraphs: [
          "Provide accurate contact and delivery information and keep your account credentials private.",
          "Signed-in customers can view recent orders in My Orders. Keep copies of your order confirmations and contact us if you require an older record.",
          "Contact us promptly if you suspect unauthorised account activity.",
        ],
      },
      {
        heading: "Questions and Disputes",
        paragraphs: [
          "Contact us using the details above and include your order number where relevant.",
          "South African law applies. Nothing in these terms removes your right to approach an appropriate regulator, ombud or court.",
          "Policy updates apply prospectively and do not remove rights relating to an existing purchase.",
        ],
      },
    ],
  ),

  privacy: policy(
    "Privacy / POPIA Policy",
    "This policy explains how Iron Culture Supplements handles personal information when you use our store.",
    [
      {
        heading: "Information We Handle",
        paragraphs: [
          "We handle information you provide when creating an account, placing an order, requesting assistance or subscribing to communications.",
        ],
        items: [
          "Your name, email address and telephone number.",
          "Delivery addresses, order details and support correspondence.",
          "Payment references, payment amounts and payment status.",
          "Technical information needed to operate and secure the website, including session information and server logs.",
        ],
      },
      {
        heading: "Why We Use Information",
        paragraphs: [
          "We use necessary information to manage accounts, process and deliver orders, confirm payments, provide support, prevent misuse and maintain required business records.",
          "Providing information is voluntary, but we may be unable to fulfil an order without the required contact and delivery details.",
          "Processing is based on applicable lawful grounds, including performing a contract, meeting legal obligations, legitimate interests or consent where required.",
        ],
      },
      {
        heading: "Service Providers",
        paragraphs: [
          "Information needed to provide the service may be handled by our payment providers, couriers, hosting and database providers, and email delivery providers.",
          "The selected payment provider collects the banking or payment credentials needed on its own payment interface. Do not send these credentials to our store.",
          "Our website uses services including Render, Neon, Cloudinary and Resend. PayFast and Ozow may be offered as payment options when enabled.",
          "External services such as Google Maps, Facebook and WhatsApp may process information when their content is loaded or you use their links. Their own privacy policies also apply.",
        ],
      },
      {
        heading: "Cookies and Website Features",
        paragraphs: [
          "The store uses session cookies to support functions such as signing in, shopping and protecting forms.",
          "Blocking these cookies may prevent parts of the store from working.",
        ],
      },
      {
        heading: "Retention, Security and Overseas Processing",
        paragraphs: [
          "Personal information should be retained only for as long as needed for the stated purpose, applicable legal obligations and legitimate recordkeeping requirements.",
          "We use access controls and technical safeguards to protect information. No internet service can guarantee absolute security.",
          "Some service providers may process information outside South Africa. Such processing must meet the applicable requirements of POPIA.",
        ],
      },
      {
        heading: "Your Rights and Contact",
        paragraphs: [
          "Contact our business email above with privacy enquiries or requests to access, correct or, where applicable, delete your personal information.",
          "You may object to applicable processing or withdraw consent where processing depends on consent. We may need to verify your identity before acting on a request.",
          "Some records may need to be retained despite a deletion request because of legal obligations.",
          "You may unsubscribe from marketing communications. Necessary order and service messages are separate from marketing.",
          "You may lodge a complaint with South Africa's Information Regulator. Complaint information is available at https://inforegulator.org.za/complaints/.",
        ],
      },
    ],
  ),

  refunds: policy(
    "Refund & Cancellation Policy",
    "Contact us with your order number when requesting a cancellation or refund.",
    [
      {
        heading: "Cancellation Requests",
        paragraphs: [
          "Contact us as soon as possible if you want to cancel an order. We will check its payment and dispatch status and explain the next steps.",
          "Closing a browser tab or returning from a payment page does not itself cancel an order or payment.",
          "If an order has already been dispatched, applicable cancellation and return rights still apply.",
        ],
      },
      {
        heading: "Online Cooling-off Rights",
        paragraphs: [
          "Where section 44 of the Electronic Communications and Transactions Act applies, you may cancel an online goods purchase without reason or penalty within seven days after receiving the goods.",
          "For that cancellation, only the direct cost of returning the goods may be charged, and payments must be refunded within 30 days of cancellation.",
          "Statutory exclusions may apply. We will not apply a blanket exclusion to all supplements or remove other rights you have under applicable law.",
        ],
      },
      {
        heading: "Refund Processing",
        paragraphs: [
          "We will explain the applicable refund amount, return arrangements and processing steps when reviewing your request.",
          "Any verification or return process must not override an applicable statutory refund deadline.",
          "Contact us if a payment appears duplicated or a refund has not arrived. Include your order number and payment reference, but never your banking password, PIN or one-time password.",
        ],
      },
      {
        heading: "Defective or Incorrect Goods",
        paragraphs: [
          "Our Returns Policy explains how to report damaged, defective or incorrect goods.",
          "Nothing in this policy limits statutory rights to a refund, replacement or repair where applicable.",
        ],
      },
    ],
  ),

  returns: policy(
    "Returns Policy",
    "We will assist with returns in accordance with the circumstances of your purchase and applicable consumer law.",
    [
      {
        heading: "How to Request a Return",
        paragraphs: [
          "Contact us with your order number, the affected product and a description of the issue.",
          "Photographs can help us assess a problem, but their absence does not automatically remove your statutory rights.",
          "Contact us before sending a parcel so we can provide return instructions. This administrative process does not limit statutory rights.",
          "Our business address is listed above. Please arrange a return with us before travelling or sending goods.",
        ],
      },
      {
        heading: "Damaged, Defective or Incorrect Products",
        paragraphs: [
          "If a product arrives damaged, defective or incorrect, contact us promptly. Do not use a product that appears unsafe.",
          "Where goods fail the applicable quality and safety requirements of the Consumer Protection Act, section 56 provides a six-month right of return after delivery, without penalty and at the supplier's risk and expense.",
          "Where that right applies, the consumer may direct the appropriate repair, replacement or refund as provided by law.",
        ],
      },
      {
        heading: "Change-of-mind Returns",
        paragraphs: [
          "Outside applicable statutory rights, we do not accept change-of-mind returns for products that have been opened, used or damaged by the customer.",
          "This restriction does not exclude claims about products supplied damaged, defective, unsafe or incorrect, or other applicable statutory cancellation rights.",
          "See our Refund & Cancellation Policy for applicable online cooling-off rights.",
        ],
      },
      {
        heading: "Return Costs",
        paragraphs: [
          "Responsibility for return costs depends on the reason for the return and applicable law.",
          "We will explain return arrangements when you contact us. We will not charge you costs that the law requires the supplier to bear.",
        ],
      },
    ],
  ),

  shipping: policy(
    "Shipping Policy",
    "We deliver orders within South Africa. Review your delivery details and charges before completing checkout.",
    [
      {
        heading: "Delivery Charges",
        items: [
          "Orders below R750 after discounts: R99 delivery.",
          "Orders of R750 or more after discounts: free delivery.",
          "The threshold is based on the merchandise subtotal after discounts, before delivery is added.",
        ],
      },
      {
        heading: "Dispatch",
        paragraphs: [
          "Orders are dispatched within 1–3 working days after confirmed payment.",
          "Working days exclude Saturdays, Sundays and South African public holidays.",
          "Dispatch means handing the parcel to the courier; it is separate from delivery to your address.",
        ],
      },
      {
        heading: "Delivery Enquiries",
        paragraphs: [
          "Contact us before ordering if you need an estimate for your destination or require delivery by a particular date.",
          "Courier transit time is additional to dispatch time. This policy does not promise delivery within the dispatch window.",
          "If a delivery is delayed, contact us with your order number so we can investigate.",
          "Delivery delays do not remove your applicable cancellation or refund rights.",
        ],
      },
      {
        heading: "Delivery Details and Receiving Your Parcel",
        paragraphs: [
          "Provide an accurate street address, postal code and contact number.",
          "Contact us promptly if your address changes. Changes may not be possible after dispatch.",
          "Report a missing parcel, incorrect item or damage on arrival so we can assist. See our Returns Policy for your rights and the return process.",
        ],
      },
    ],
  ),
};