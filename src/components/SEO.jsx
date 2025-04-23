import React, { useEffect } from 'react';

/**
 * SEO component that manages all metadata for the application.
 * This component dynamically updates the document head with SEO-friendly tags
 * without relying on external dependencies.
 * 
 * @param {Object} props - Component properties
 * @param {string} props.title - Page title
 * @param {string} props.description - Page description
 * @param {string} props.image - Social sharing image URL
 * @param {string} props.url - Canonical URL
 * @param {string} props.route - Current route
 * @returns {null} This component doesn't render anything visible
 */
function SEO({ 
  title = 'TR-909 Rhythm Composer (Web Edition)',
  description = 'Classic TR-909 drum machine emulation for the modern web with authentic sounds and workflow.',
  image = '/TR-909-social.jpg',
  url = 'https://tr909.sonicarchetype.com',
  route = ''
}) {
  useEffect(() => {
    // Ensure image and URL are absolute
    const absoluteImage = image.startsWith('http') ? image : `${url}${image}`;
    const canonicalUrl = route ? `${url}${route}` : url;
    
    // Update document title
    document.title = title;
    
    // Helper to create or update meta tags
    const setMetaTag = (name, content) => {
      let meta = document.querySelector(`meta[name="${name}"]`) || 
                 document.querySelector(`meta[property="${name}"]`);
      
      if (!meta) {
        meta = document.createElement('meta');
        if (name.startsWith('og:') || name.startsWith('twitter:')) {
          meta.setAttribute('property', name);
        } else {
          meta.setAttribute('name', name);
        }
        document.head.appendChild(meta);
      }
      
      meta.setAttribute('content', content);
    };
    
    // Set basic meta tags
    setMetaTag('description', description);
    
    // Open Graph tags for social sharing
    setMetaTag('og:title', title);
    setMetaTag('og:description', description);
    setMetaTag('og:image', absoluteImage);
    setMetaTag('og:url', canonicalUrl);
    setMetaTag('og:type', 'website');
    
    // Twitter Card tags
    setMetaTag('twitter:card', 'summary_large_image');
    setMetaTag('twitter:title', title);
    setMetaTag('twitter:description', description);
    setMetaTag('twitter:image', absoluteImage);
    
    // Set canonical link
    let canonicalLink = document.querySelector('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute('href', canonicalUrl);
    
    // Structured data (JSON-LD) for search engines
    let jsonLd = document.querySelector('script[type="application/ld+json"]');
    if (!jsonLd) {
      jsonLd = document.createElement('script');
      jsonLd.setAttribute('type', 'application/ld+json');
      document.head.appendChild(jsonLd);
    }
    
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      'name': title,
      'description': description,
      'image': absoluteImage,
      'url': canonicalUrl,
      'applicationCategory': 'MusicApplication',
      'offers': {
        '@type': 'Offer',
        'price': '0',
        'priceCurrency': 'USD'
      }
    };
    
    jsonLd.textContent = JSON.stringify(structuredData);
    
    // Clean up function
    return () => {
      // This is usually not needed but added for completeness
      // Most meta tags will be updated rather than removed
    };
  }, [title, description, image, url, route]);
  
  // This component doesn't render anything visible
  return null;
}

export default SEO; 