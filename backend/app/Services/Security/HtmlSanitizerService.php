<?php

namespace App\Services\Security;

class HtmlSanitizerService
{
    /**
     * Allowed HTML tags for user-generated content
     */
    private const ALLOWED_TAGS = [
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'strike', 'del',
        'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'blockquote', 'code', 'pre', 'span', 'div'
    ];

    /**
     * Allowed attributes for specific tags
     */
    private const ALLOWED_ATTRIBUTES = [
        'a' => ['href', 'title', 'target'],
        'span' => ['class'],
        'div' => ['class'],
        'p' => ['class'],
        'blockquote' => ['class'],
        'code' => ['class'],
    ];

    /**
     * Protocols allowed in href attributes
     */
    private const ALLOWED_PROTOCOLS = ['http', 'https', 'mailto', 'tel'];

    /**
     * Sanitize HTML content
     */
    public function sanitize(?string $content): string
    {
        if (empty($content)) {
            return '';
        }

        // Convert special characters to HTML entities first
        $content = htmlspecialchars($content, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        // Then decode allowed tags back
        $allowedTagsString = '<' . implode('><', self::ALLOWED_TAGS) . '>';
        $content = strip_tags($content, $allowedTagsString);

        // Parse and filter attributes
        $content = $this->filterAttributes($content);

        return $content;
    }

    /**
     * Sanitize plain text (no HTML allowed)
     */
    public function sanitizePlainText(?string $content): string
    {
        if (empty($content)) {
            return '';
        }

        return htmlspecialchars($content, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    /**
     * Filter attributes in HTML content
     */
    private function filterAttributes(string $content): string
    {
        // Use DOMDocument to parse and clean attributes
        libxml_use_internal_errors(true);
        $dom = new \DOMDocument();
        $dom->loadHTML('<?xml encoding="UTF-8">' . $content, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
        libxml_clear_errors();

        // Process all elements
        $xpath = new \DOMXPath($dom);
        $elements = $xpath->query('//*');

        foreach ($elements as $element) {
            $tagName = strtolower($element->nodeName);
            
            // Remove event handlers (onclick, onerror, etc.)
            $attributesToRemove = [];
            foreach ($element->attributes as $attribute) {
                $attrName = strtolower($attribute->nodeName);
                
                // Remove event handlers
                if (str_starts_with($attrName, 'on')) {
                    $attributesToRemove[] = $attrName;
                    continue;
                }
                
                // Remove data attributes that could be dangerous
                if (str_starts_with($attrName, 'data-')) {
                    $attributesToRemove[] = $attrName;
                    continue;
                }
                
                // Check if attribute is allowed for this tag
                if (!isset(self::ALLOWED_ATTRIBUTES[$tagName]) || !in_array($attrName, self::ALLOWED_ATTRIBUTES[$tagName], true)) {
                    $attributesToRemove[] = $attrName;
                }
                
                // Sanitize href attributes
                if ($attrName === 'href' && $tagName === 'a') {
                    $href = $attribute->nodeValue;
                    if (!$this->isValidUrl($href)) {
                        $attributesToRemove[] = $attrName;
                    }
                }
            }
            
            // Remove disallowed attributes
            foreach ($attributesToRemove as $attrName) {
                $element->removeAttribute($attrName);
            }
            
            // Add rel="noopener noreferrer" to external links
            if ($tagName === 'a') {
                $href = $element->getAttribute('href');
                if ($this->isExternalUrl($href)) {
                    $element->setAttribute('rel', 'noopener noreferrer');
                    $element->setAttribute('target', '_blank');
                }
            }
        }

        // Extract body content
        $body = $dom->getElementsByTagName('body')->item(0);
        if ($body) {
            $content = '';
            foreach ($body->childNodes as $child) {
                $content .= $dom->saveHTML($child);
            }
            return $content;
        }

        return $content;
    }

    /**
     * Check if URL is valid and safe
     */
    private function isValidUrl(string $url): bool
    {
        // Allow relative URLs
        if (str_starts_with($url, '/') || str_starts_with($url, '#') || str_starts_with($url, '?')) {
            return true;
        }

        // Check protocol
        $parsed = parse_url($url);
        if (isset($parsed['scheme'])) {
            return in_array(strtolower($parsed['scheme']), self::ALLOWED_PROTOCOLS, true);
        }

        return false;
    }

    /**
     * Check if URL is external
     */
    private function isExternalUrl(string $url): bool
    {
        if (str_starts_with($url, '//') || str_starts_with($url, 'http://') || str_starts_with($url, 'https://')) {
            return true;
        }
        return false;
    }

    /**
     * Sanitize array of content recursively
     */
    public function sanitizeArray(array $data, array $htmlFields = []): array
    {
        $sanitized = [];
        foreach ($data as $key => $value) {
            if (is_array($value)) {
                $sanitized[$key] = $this->sanitizeArray($value, $htmlFields);
            } elseif (is_string($value)) {
                $sanitized[$key] = in_array($key, $htmlFields, true) 
                    ? $this->sanitize($value) 
                    : $this->sanitizePlainText($value);
            } else {
                $sanitized[$key] = $value;
            }
        }
        return $sanitized;
    }
}
