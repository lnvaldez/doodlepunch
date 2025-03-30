# similarity.py
import spacy
import sys

# Load spaCy's large English model with word vectors
nlp = spacy.load("en_core_web_lg")

def calculate_similarity(word1, word2):
    doc1 = nlp(word1)
    doc2 = nlp(word2)
    return doc1.similarity(doc2)

if __name__ == "__main__":
    word1 = sys.argv[1]
    word2 = sys.argv[2]
    similarity = calculate_similarity(word1, word2)
    print(similarity)