"""Elephant heatmap generation with the MobileNet-v1 classifier (TF1 checkpoint).

Ported from the Heatmapper4 EC2 AMI worker
(detweb-server/app/detweb/tf_detect/infer/MobileNetHeatmapper.py). The network is
fully convolutional: a full-resolution RGB image goes in, a stride-32
(H/32 x W/32 x 2) softmax map comes out, and channel 1 is the elephant class.

Variable names and batch-normalization defaults must match the TF1 checkpoint.
"""

import tensorflow.compat.v1 as tf

tf.disable_v2_behavior()

# (depthwise-separable?, stride, depth) per MobileNet-v1 layer; layer 0 is a full conv.
_CONV_DEFS = [
    (False, 2, 32),
    (True, 1, 64),
    (True, 2, 128),
    (True, 1, 128),
    (True, 2, 256),
    (True, 1, 256),
    (True, 2, 512),
    (True, 1, 512),
    (True, 1, 512),
    (True, 1, 512),
    (True, 1, 512),
    (True, 1, 512),
    (True, 2, 1024),
    (True, 1, 1024),
]


def _batch_norm_relu(net):
    depth = net.shape[-1]
    with tf.variable_scope('BatchNorm'):
        beta = tf.get_variable('beta', [depth])
        mean = tf.get_variable('moving_mean', [depth])
        variance = tf.get_variable('moving_variance', [depth])
    net = tf.nn.batch_normalization(net, mean, variance, beta, None, 1e-3)
    return tf.nn.relu(net)


def _conv(net, depth, kernel, stride):
    weights = tf.get_variable('weights', [kernel, kernel, net.shape[-1], depth])
    return tf.nn.conv2d(net, weights, [1, stride, stride, 1], 'SAME')


def _depthwise(net, stride):
    weights = tf.get_variable('depthwise_weights', [3, 3, net.shape[-1], 1])
    return tf.nn.depthwise_conv2d(net, weights, [1, stride, stride, 1], 'SAME')


def mobilenet_v1_logits(image, num_classes=2):
    """Logits (1 x H/32 x W/32 x num_classes) for a [-1, 1] scaled NHWC float image."""
    net = image
    with tf.variable_scope('MobilenetV1'):
        for i, (separable, stride, depth) in enumerate(_CONV_DEFS):
            if not separable:
                with tf.variable_scope('Conv2d_%d' % i):
                    net = _batch_norm_relu(_conv(net, depth, 3, stride))
                continue
            with tf.variable_scope('Conv2d_%d_depthwise' % i):
                net = _batch_norm_relu(_depthwise(net, stride))
            with tf.variable_scope('Conv2d_%d_pointwise' % i):
                net = _batch_norm_relu(_conv(net, depth, 1, 1))
        with tf.variable_scope('Logits/Conv2d_1c_3x3'):
            biases = tf.get_variable('biases', [num_classes])
            return _conv(net, num_classes, 3, 1) + biases


class MobileNetHeatmapper(object):
    """Generate elephant heatmaps using the MobileNet network."""

    def __init__(self, nn_model_fp):
        graph = tf.Graph()
        with graph.as_default():
            # uint8 HxWx3 RGB image (decoded + optionally rotated outside the graph)
            self.image_in = tf.placeholder(dtype=tf.uint8, shape=[None, None, 3])
            image = tf.image.convert_image_dtype(self.image_in, dtype=tf.float32)  # -> [0,1]
            image = tf.subtract(image, 0.5)
            image = tf.multiply(image, 2.0)                                        # -> [-1,1]
            image = tf.expand_dims(image, 0)

            self.probs = tf.nn.softmax(mobilenet_v1_logits(image))

            saver = tf.train.Saver(tf.global_variables())
            self.sess = tf.Session(graph=graph)
            saver.restore(self.sess, nn_model_fp)

    def generate(self, image_rgb):
        """Run inference on an HxWx3 uint8 RGB array.

        Returns the 2D elephant heatmap (H/32 x W/32 float32), i.e. softmax channel 1.
        """
        probs = self.sess.run(self.probs, feed_dict={self.image_in: image_rgb})
        return probs[0, :, :, 1]
